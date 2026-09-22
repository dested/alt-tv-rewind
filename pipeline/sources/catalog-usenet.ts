// Usenet cataloger: inventory the five Usenet sources into the catalog tables,
// screen every record for the four screened shows with deterministic rules,
// thread records into cross-source conversations, layer conversation context on
// top of the screen, and write dispositions + checkpoints + a summary. One
// streaming pass per source; records.jsonl is read once. The 388k-record /
// 2.4GB corpus is handled with random reads for the raw From line and bounded
// in-memory batches for the DB writers.
import { mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ROOT } from '../lib/context'
import { readJsonl, writeJson, writeJsonl } from '../lib/checkpoint'
import { loadRegistry } from '../lib/context'
import { buildEpisodeIndex } from '../lib/episode-index'
import { normalizeSubject, posterKey } from '../lib/normalize'
import { detectSpam } from '../lib/spam'
import { AliasesFile, EpisodesFile } from '../lib/types'
import {
  loadEpisodeIds,
  loadShowIds,
  loadOrganizedSummary,
  organizedPath,
  upsertArtifacts,
  upsertDispositions,
  upsertObservations,
  upsertRecords,
  upsertSource,
  type RecordInsert,
} from './inventory'
import { readRawFrom, closeRawFiles } from './raw-from'
import { dispose, screenRecord, type ScreenDisposition, type ShowScreenConfig } from './screen'
import { buildConversations, USENET_SOURCE_ORDER, type ConversationSummary, type SlimRecord } from './conversations'
import {
  COMMUNITY_SOURCES,
  ERA_END,
  ORGANIZED_SCHEMA_VERSION,
  OrganizedObservation,
  OrganizedSource,
  SCREENED_SHOWS,
  SHOW_TERMS,
  SOURCE_FACTS,
  SeedAssociation,
  UsenetRecord,
  type CatalogOpts,
  type Disposition,
  type InputFingerprint,
} from './types'

const SEED_CANDIDATE = 'candidate'

// Extra newsgroups (beyond the show's registry newsgroup) that count as the
// show's own distribution for the crosspost rule.
const EXTRA_GROUPS: Record<string, string[]> = {
  'family-guy': ['alt.tv.familyguy'],
  simpsons: ['alt.tv.simpsons.itchy-scratchy'],
  'south-park': ['alt.tv.south-park'],
}

const RECORD_FLUSH = 1000
const BODY_TRUNCATION = 65536

export type SourceStat = {
  records: number
  observations: number
  variants: number
  orphans: number
  spam: number
  missingId: number
  longBodies: number
  dayOnly: number
  undated: number
  posterKeyFromRaw: number
  posterKeyFallback: number
}

export type ShowStat = {
  evaluated: number
  seeds: number
  byStatus: Record<string, number>
  byMethod: Record<string, number>
  byReason: Record<string, number>
  inEraAccepted: number
  acceptedConversations: number
}

export type UsenetCatalogSummary = {
  sources: Record<string, SourceStat>
  shows: Record<string, ShowStat>
  conversations: ConversationSummary
  durationMs: number
}

function emptySourceStat(): SourceStat {
  return {
    records: 0,
    observations: 0,
    variants: 0,
    orphans: 0,
    spam: 0,
    missingId: 0,
    longBodies: 0,
    dayOnly: 0,
    undated: 0,
    posterKeyFromRaw: 0,
    posterKeyFallback: 0,
  }
}

function buildShowConfigs(): { slug: string; config: ShowScreenConfig }[] {
  const registry = loadRegistry()
  const newsgroupOf = new Map(registry.map((s) => [s.slug, s.newsgroup]))
  return SCREENED_SHOWS.map((slug) => {
    const episodes = EpisodesFile.parse(JSON.parse(readFileSync(join(ROOT, 'data', 'shows', slug, 'episodes.json'), 'utf8')))
    const aliases = AliasesFile.parse(JSON.parse(readFileSync(join(ROOT, 'data', 'shows', slug, 'aliases.json'), 'utf8')))
    const groups: string[] = []
    const own = newsgroupOf.get(slug)
    if (own !== undefined) groups.push(own)
    for (const g of EXTRA_GROUPS[slug] ?? []) groups.push(g)
    const terms = SHOW_TERMS[slug] ?? []
    return { slug, config: { slug, terms, groups, index: buildEpisodeIndex(episodes, aliases) } }
  })
}

// candidate seeds per show slug → set of recordIds.
async function loadSeeds(): Promise<Map<string, Set<string>>> {
  const seeds = new Map<string, Set<string>>()
  for (const slug of SCREENED_SHOWS) seeds.set(slug, new Set())
  for await (const seed of readJsonl(organizedPath('show-associations.jsonl'), SeedAssociation)) {
    if (seed.status !== SEED_CANDIDATE) continue
    const set = seeds.get(seed.showId)
    if (set !== undefined) set.add(seed.recordId)
  }
  return seeds
}

export async function catalogUsenet(opts: CatalogOpts): Promise<UsenetCatalogSummary> {
  const started = Date.now()
  const log = opts.log
  const workDir = join(ROOT, 'data', 'work', 'sources')
  mkdirSync(workDir, { recursive: true })

  const order = [...USENET_SOURCE_ORDER]
  const selected = opts.sources ? order.filter((s) => opts.sources?.includes(s)) : order
  const showConfigs = buildShowConfigs()
  const seedSets = await loadSeeds()

  // Global accumulators across sources.
  const slimRecords: SlimRecord[] = []
  const slimById = new Map<string, SlimRecord>()
  const inEraByRecord = new Map<string, boolean>()
  const dispositions: Disposition[] = []
  const dispIndex = new Map<string, Disposition>() // `${recordId}|${show}`
  const recordDbId = new Map<string, number>() // recordId → db id (non-dryRun only)
  const sources: Record<string, SourceStat> = {}
  const evaluated: Record<string, number> = {}
  const seedsSeen: Record<string, number> = {}
  for (const { slug } of showConfigs) {
    evaluated[slug] = 0
    seedsSeen[slug] = 0
  }

  const dispKey = (recordId: string, show: string): string => `${recordId}|${show}`
  let processed = 0

  for (const sourceKey of selected) {
    const src = OrganizedSource.parse(JSON.parse(readFileSync(organizedPath('sources', sourceKey, 'source.json'), 'utf8')))
    const facts = SOURCE_FACTS[sourceKey]
    const communityShow = COMMUNITY_SOURCES[sourceKey] ?? null
    const communityGroup = facts?.communityKey ?? sourceKey
    const stat = emptySourceStat()
    sources[sourceKey] = stat

    let sourceId = -1
    let artifactIdByPath = new Map<string, number>()
    if (!opts.dryRun) {
      const row = await upsertSource(src)
      sourceId = row.id
      artifactIdByPath = await upsertArtifacts(sourceId, sourceKey)
    }

    // First observation per record (byte range of the canonical raw message).
    type FirstObs = { artifactPath: string; byteOffset: number; byteLength: number }
    const firstObs = new Map<string, FirstObs>()
    for await (const o of readJsonl(organizedPath('sources', sourceKey, 'observations.jsonl'), OrganizedObservation)) {
      stat.observations++
      if (firstObs.has(o.recordId)) continue
      if (o.byteOffset === undefined || o.byteLength === undefined) continue
      firstObs.set(o.recordId, { artifactPath: o.artifactPath, byteOffset: o.byteOffset, byteLength: o.byteLength })
    }

    const contentByRecord = new Map<string, string>()
    const recordDbIdThisSource = new Map<string, number>()
    let recordBatch: RecordInsert[] = []
    const flushRecords = async (): Promise<void> => {
      if (recordBatch.length === 0 || opts.dryRun) {
        recordBatch = []
        return
      }
      const batch = recordBatch
      recordBatch = []
      const ids = await upsertRecords(sourceId, batch)
      for (const [rid, id] of ids) {
        recordDbIdThisSource.set(rid, id)
        recordDbId.set(rid, id)
      }
    }

    for await (const record of readJsonl(organizedPath('sources', sourceKey, 'records.jsonl'), UsenetRecord)) {
      stat.records++
      processed++

      // Poster identity: from the raw From line of the canonical observation,
      // else the collected display name. The email address is only hashed.
      const obs = firstObs.get(record.recordId)
      let name: string
      let pKey: string
      if (obs !== undefined) {
        const raw = readRawFrom(join(ROOT, obs.artifactPath), obs.byteOffset, obs.byteLength)
        name = raw.name
        pKey = raw.posterKey
        stat.posterKeyFromRaw++
      } else {
        name = record.author?.displayName ?? 'unknown'
        pKey = posterKey(null, name)
        stat.posterKeyFallback++
      }

      const subjectNorm = normalizeSubject(record.title).norm
      const spamReason = detectSpam({ subject: record.title, body: record.bodyText, newsgroups: record.newsgroups, postedAt: record.postedAt })
      const isSpam = spamReason !== null
      if (isSpam) stat.spam++
      if (record.identityMethod !== 'message-id') stat.missingId++
      if (record.bodyText.length > BODY_TRUNCATION) stat.longBodies++
      if (record.datePrecision === 'day') stat.dayOnly++

      // Slim record: legacy day-only convention (noon UTC), unknown → undated.
      let postedAt: string | null
      let dateOnly: boolean
      if (record.datePrecision === 'day' && record.postedDate !== null) {
        postedAt = `${record.postedDate}T12:00:00.000Z`
        dateOnly = true
      } else if (record.datePrecision === 'unknown') {
        postedAt = null
        dateOnly = false
      } else {
        postedAt = record.postedAt
        dateOnly = false
      }
      if (postedAt === null) stat.undated++

      const slim: SlimRecord = {
        recordId: record.recordId,
        canonicalId: record.canonicalId,
        sourceId: sourceKey,
        externalId: record.externalId,
        subject: record.title,
        subjectNorm,
        fromName: name,
        posterKey: pKey,
        postedAt,
        dateOnly,
        references: record.references,
        inReplyTo: record.inReplyTo,
        isSpam,
      }
      slimRecords.push(slim)
      slimById.set(slim.recordId, slim)

      const inEra = record.postedDate !== null && record.postedDate <= ERA_END
      inEraByRecord.set(record.recordId, inEra)

      // DB record.
      if (!opts.dryRun) {
        contentByRecord.set(record.recordId, record.contentSha256)
        recordBatch.push({
          record_id: record.recordId,
          canonical_id: record.canonicalId,
          kind: 'post',
          external_id: record.externalId,
          thread_external_id: record.threadExternalId,
          identity_method: record.identityMethod,
          original_url: record.originalUrl,
          title: record.title,
          author_name: name,
          author_external_id: record.author?.externalId ?? null,
          poster_key: pKey,
          posted_at: record.postedAt,
          posted_date: record.postedDate,
          date_precision: record.datePrecision,
          date_timezone: record.dateTimezone,
          date_raw: record.dateRaw,
          date_derivation: record.dateDerivation,
          newsgroups: record.newsgroups,
          references: record.references,
          in_reply_to: record.inReplyTo,
          body: record.bodyText,
          body_length: record.bodyText.length,
          content_sha256: record.contentSha256,
          has_content_conflict: record.hasContentConflict ?? false,
          is_spam: isSpam,
          spam_reason: spamReason,
          metadata: JSON.stringify({
            dateHeaders: record.dateHeaders,
            identityMethod: record.identityMethod,
            observationCount: record.observationCount ?? null,
          }),
        })
        if (recordBatch.length >= RECORD_FLUSH) await flushRecords()
      }

      // Screening for all four shows.
      for (const { slug, config } of showConfigs) {
        let d: ScreenDisposition
        if (communityShow === slug) {
          d = isSpam
            ? { status: 'excluded', method: 'screen', evidence: spamReason ?? 'spam', confidence: null, reason: 'spam' }
            : { status: 'accepted', method: 'community', evidence: `community:${communityGroup}`, confidence: 100, reason: null }
        } else {
          d = dispose(
            screenRecord({ subject: record.title, subjectNorm, body: record.bodyText, newsgroups: record.newsgroups, spamReason }, config)
          )
        }
        evaluated[slug] = (evaluated[slug] ?? 0) + 1
        const isSeed = seedSets.get(slug)?.has(record.recordId) ?? false
        if (isSeed) seedsSeen[slug] = (seedsSeen[slug] ?? 0) + 1

        const method = isSeed && d.reason === 'no_mention' ? 'seed-only' : d.method
        const keep = isSeed || d.reason !== 'no_mention'
        if (!keep) continue
        const disp: Disposition = {
          recordId: record.recordId,
          sourceId: sourceKey,
          show: slug,
          status: d.status,
          method,
          evidence: d.evidence,
          confidence: d.confidence,
          reason: d.reason,
          conversationKey: null,
          inEra,
          episodeSlug: null,
          seed: isSeed,
        }
        dispositions.push(disp)
        dispIndex.set(dispKey(record.recordId, slug), disp)
      }

      if (processed % 20000 === 0) log(`catalog: ${processed} records processed`)
    }

    await flushRecords()

    if (!opts.dryRun) {
      const obsResult = await upsertObservations(sourceKey, recordDbIdThisSource, artifactIdByPath, contentByRecord)
      stat.variants = obsResult.variants
      stat.orphans = obsResult.orphans
    }

    log(
      `[${sourceKey}] records=${stat.records} obs=${stat.observations} spam=${stat.spam} ` +
        `missingId=${stat.missingId} dayOnly=${stat.dayOnly} undated=${stat.undated} ` +
        `fromRaw=${stat.posterKeyFromRaw} fallback=${stat.posterKeyFallback}` +
        (opts.dryRun ? '' : ` variants=${stat.variants} orphans=${stat.orphans}`)
    )
  }

  closeRawFiles()

  // Cross-source conversations.
  const { conversations, summary: conversationSummary } = buildConversations(slimRecords, log)

  // recordId → conversation key (a record present in any conversation is dated).
  const recordConvKey = new Map<string, string>()
  for (const conv of conversations) {
    for (const member of conv.members) {
      recordConvKey.set(member.recordId, conv.key)
      for (const addId of member.additionalRecordIds) recordConvKey.set(addId, conv.key)
    }
  }

  // Context pass per show: a conversation with any accepted member pulls its
  // other non-spam members in as context.
  for (const conv of conversations) {
    const memberRecordIds: string[] = []
    for (const member of conv.members) {
      memberRecordIds.push(member.recordId)
      for (const addId of member.additionalRecordIds) memberRecordIds.push(addId)
    }
    for (const { slug } of showConfigs) {
      const acceptedIds = new Set<string>()
      for (const rid of memberRecordIds) {
        const d = dispIndex.get(dispKey(rid, slug))
        if (d !== undefined && d.status === 'accepted') acceptedIds.add(rid)
      }
      if (acceptedIds.size === 0) continue
      const evidence = `conversation ${conv.key}: ${acceptedIds.size} accepted`
      for (const rid of memberRecordIds) {
        if (acceptedIds.has(rid)) {
          const d = dispIndex.get(dispKey(rid, slug))
          if (d !== undefined) d.conversationKey = conv.key
          continue
        }
        const rec = slimById.get(rid)
        if (rec === undefined || rec.isSpam) continue // never override spam
        const existing = dispIndex.get(dispKey(rid, slug))
        if (existing !== undefined) {
          if (existing.status === 'excluded' && existing.reason === 'spam') continue
          existing.status = 'context'
          existing.method = 'conversation-context'
          existing.evidence = evidence
          existing.confidence = null
          existing.reason = null
          existing.conversationKey = conv.key
        } else {
          const created: Disposition = {
            recordId: rid,
            sourceId: rec.sourceId,
            show: slug,
            status: 'context',
            method: 'conversation-context',
            evidence,
            confidence: null,
            reason: null,
            conversationKey: conv.key,
            inEra: inEraByRecord.get(rid) ?? false,
            episodeSlug: null,
            seed: false,
          }
          dispositions.push(created)
          dispIndex.set(dispKey(rid, slug), created)
        }
      }
    }
  }

  // Accepted/needs_review records with no conversation are undated → needs_review.
  for (const d of dispositions) {
    if ((d.status === 'accepted' || d.status === 'needs_review') && !recordConvKey.has(d.recordId)) {
      d.status = 'needs_review'
      d.reason = 'undated'
      d.confidence = null
    }
  }

  // Per-show statistics over the final dispositions.
  const shows: Record<string, ShowStat> = {}
  for (const { slug } of showConfigs) {
    shows[slug] = {
      evaluated: evaluated[slug] ?? 0,
      seeds: seedsSeen[slug] ?? 0,
      byStatus: {},
      byMethod: {},
      byReason: {},
      inEraAccepted: 0,
      acceptedConversations: 0,
    }
  }
  const acceptedConvKeys = new Map<string, Set<string>>()
  for (const { slug } of showConfigs) acceptedConvKeys.set(slug, new Set())
  for (const d of dispositions) {
    const s = shows[d.show]
    if (s === undefined) continue
    s.byStatus[d.status] = (s.byStatus[d.status] ?? 0) + 1
    s.byMethod[d.method] = (s.byMethod[d.method] ?? 0) + 1
    if (d.reason !== null) s.byReason[d.reason] = (s.byReason[d.reason] ?? 0) + 1
    if (d.status === 'accepted') {
      if (d.inEra) s.inEraAccepted++
      if (d.conversationKey !== null) acceptedConvKeys.get(d.show)?.add(d.conversationKey)
    }
  }
  for (const { slug } of showConfigs) {
    const s = shows[slug]
    if (s !== undefined) s.acceptedConversations = acceptedConvKeys.get(slug)?.size ?? 0
  }

  const summary: UsenetCatalogSummary = {
    sources,
    shows,
    conversations: conversationSummary,
    durationMs: Date.now() - started,
  }

  // Checkpoints (written in both dry and real runs).
  await writeJsonl(join(workDir, 'usenet-slim.jsonl'), slimRecords)
  await writeJsonl(join(workDir, 'conversations.jsonl'), conversations)
  await writeJsonl(join(workDir, 'dispositions-usenet.jsonl'), dispositions)
  writeJson(join(workDir, 'usenet-catalog-summary.json'), summary)
  const organized = loadOrganizedSummary()
  const fingerprint: InputFingerprint = {
    organizedBuiltAt: organized.builtAt,
    recordCount: organized.recordCount,
    observationCount: organized.observationCount,
    extractorVersion: 'usenet-catalog-1',
    schemaVersion: ORGANIZED_SCHEMA_VERSION,
  }
  writeJson(join(workDir, 'fingerprint.json'), fingerprint)

  // DB dispositions for all four shows.
  if (!opts.dryRun) {
    const showIds = await loadShowIds()
    const episodeIds = new Map<string, Map<string, number>>()
    for (const { slug } of showConfigs) {
      const id = showIds.get(slug)
      if (id !== undefined) episodeIds.set(slug, await loadEpisodeIds(id))
    }
    const result = await upsertDispositions(dispositions, recordDbId, showIds, episodeIds)
    log(`dispositions: wrote ${result.written} (${result.unknownRecords} unknown records)`)
  }

  // Per-show table.
  for (const { slug } of showConfigs) {
    const s = shows[slug]
    if (s === undefined) continue
    const statusStr = Object.entries(s.byStatus)
      .map(([k, v]) => `${k}=${v}`)
      .join(' ')
    log(`[show ${slug}] evaluated=${s.evaluated} seeds=${s.seeds} ${statusStr} inEraAccepted=${s.inEraAccepted} convs=${s.acceptedConversations}`)
  }

  return summary
}
