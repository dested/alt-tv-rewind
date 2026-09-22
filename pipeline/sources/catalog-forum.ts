// Catalog the official South Park forum: inventory its posts/observations, then
// screen each post to a disposition against the four collected episode topics.
// Bodies are stored verbatim (their `[quote]` markers survive here; conversion to
// Usenet grammar happens at import via forum-quotes.ts). Every post belongs to an
// official episode-discussion topic, so screening is a topic lookup, not a scan.
import { join } from 'node:path'
import { z } from 'zod'
import { ROOT } from '../lib/context'
import { readJsonl, writeJson, writeJsonl } from '../lib/checkpoint'
import {
  loadEpisodeIds,
  loadOrganizedSources,
  loadShowIds,
  organizedPath,
  upsertArtifacts,
  upsertDispositions,
  upsertObservations,
  upsertRecords,
  upsertSource,
  type RecordInsert,
} from './inventory'
import {
  ERA_END,
  FORUM_SOURCE,
  FORUM_TOPICS,
  ForumRecord,
  SOURCES_WORK_DIR,
  type CatalogOpts,
  type Disposition,
} from './types'

const FORUM_SHOW = 'south-park'
const DATE_DERIVATION = 'displayed post time; page footer states UTC'

// The organizer strips edit fields into observations, not records; read them
// back here (the shared OrganizedObservation schema drops them, so parse a
// narrower shape with just what the record metadata and the checks need).
const ForumObservation = z.object({
  recordId: z.string().length(64),
  contentSha256: z.string().length(64),
  capturedAt: z.string().nullable().optional(),
  editNotice: z.string().nullable().optional(),
  editedAt: z.string().nullable().optional(),
  editedDate: z.string().nullable().optional(),
  editedDateRaw: z.string().nullable().optional(),
  editedDatePrecision: z.string().nullable().optional(),
  editCount: z.number().int().nullable().optional(),
})

type EditInfo = {
  editNotice: string
  editedAt: string | null
  editedDate: string | null
  editedDateRaw: string | null
  editedDatePrecision: string | null
  editCount: number | null
}

type TopicSummary = {
  title: string
  episodeSlug: string
  records: number
  observations: number
  firstPostId: string | null
  firstPostAt: string | null
  lastPostAt: string | null
}

export type ForumCatalogSummary = {
  topics: Record<string, TopicSummary>
  records: number
  observations: number
  duplicateObservations: string[]
  variants: number
  unknownTopic: number
  checks: {
    post357190: {
      postedAt: string | null
      datePrecision: string
      capturedAt: string | null
      editNotice: EditInfo | null
    }
  }
}

function forumPosterKey(externalId: string | null, displayName: string): string {
  const suffix = externalId ?? `n:${displayName.toLowerCase()}`
  return new Bun.CryptoHasher('sha256').update(`forum:${FORUM_SOURCE}:${suffix}`).digest('hex').slice(0, 16)
}

function editOf(o: z.infer<typeof ForumObservation>): EditInfo | null {
  if (o.editNotice === undefined || o.editNotice === null || o.editNotice === '') return null
  return {
    editNotice: o.editNotice,
    editedAt: o.editedAt ?? null,
    editedDate: o.editedDate ?? null,
    editedDateRaw: o.editedDateRaw ?? null,
    editedDatePrecision: o.editedDatePrecision ?? null,
    editCount: o.editCount ?? null,
  }
}

export async function catalogForum(opts: CatalogOpts): Promise<ForumCatalogSummary> {
  const { log, dryRun } = opts
  const restricted = opts.sources !== undefined
  const src = loadOrganizedSources().find((s) => s.sourceId === FORUM_SOURCE)
  if (src === undefined) throw new Error(`no organized source "${FORUM_SOURCE}"`)

  const records: ForumRecord[] = []
  for await (const r of readJsonl(organizedPath('sources', FORUM_SOURCE, 'records.jsonl'), ForumRecord)) {
    records.push(r)
  }
  const contentByRecord = new Map(records.map((r) => [r.recordId, r.contentSha256]))

  // First observation per record supplies its edit notice and capture time;
  // per-record counts drive the duplicate-observation and variant figures.
  const editByRecord = new Map<string, EditInfo | null>()
  const capturedByRecord = new Map<string, string | null>()
  const obsCountByRecord = new Map<string, number>()
  let observations = 0
  let variants = 0
  for await (const o of readJsonl(organizedPath('sources', FORUM_SOURCE, 'observations.jsonl'), ForumObservation)) {
    observations++
    obsCountByRecord.set(o.recordId, (obsCountByRecord.get(o.recordId) ?? 0) + 1)
    if (!editByRecord.has(o.recordId)) {
      editByRecord.set(o.recordId, editOf(o))
      capturedByRecord.set(o.recordId, o.capturedAt ?? null)
    }
    const canonical = contentByRecord.get(o.recordId)
    if (canonical !== undefined && canonical !== o.contentSha256) variants++
  }

  // This snapshot is fixed; a different count means a different bundle.
  if (!restricted) {
    if (records.length !== 1324) throw new Error(`forum records ${records.length} !== 1324 (unexpected bundle)`)
    if (observations !== 1326) throw new Error(`forum observations ${observations} !== 1326 (unexpected bundle)`)
  }

  const recordInserts: RecordInsert[] = records.map((r) => ({
    record_id: r.recordId,
    canonical_id: r.canonicalId,
    kind: 'post',
    external_id: r.externalId,
    thread_external_id: r.threadExternalId,
    identity_method: 'native-id',
    original_url: r.originalUrl,
    title: r.title,
    author_name: r.author?.displayName ?? null,
    author_external_id: r.author?.externalId ?? null,
    // Deleted/guest posts have no stable identity, so no poster_key.
    poster_key: r.author === null ? null : forumPosterKey(r.author.externalId, r.author.displayName),
    posted_at: r.postedAt,
    posted_date: r.postedDate,
    date_precision: r.datePrecision,
    date_timezone: r.dateTimezone,
    date_raw: r.dateRaw,
    date_derivation: DATE_DERIVATION,
    newsgroups: [],
    references: [],
    in_reply_to: null,
    body: r.bodyText,
    body_length: r.bodyText.length,
    content_sha256: r.contentSha256,
    has_content_conflict: r.hasContentConflict,
    is_spam: false,
    spam_reason: null,
    metadata: JSON.stringify({
      editNotice: editByRecord.get(r.recordId) ?? null,
      observationCount: r.observationCount,
    }),
  }))

  // Dispositions: every post is an accepted official-topic reaction; an
  // unrecognized topic (expected: none) is held for review.
  let unknownTopic = 0
  const dispositions: Disposition[] = records.map((r) => {
    const topic = r.threadExternalId
    const t = topic === null ? undefined : FORUM_TOPICS[topic]
    const inEra = r.postedDate === null ? true : r.postedDate <= ERA_END
    const conversationKey = topic === null ? null : `forum:${FORUM_SOURCE}:${topic}`
    if (t === undefined) {
      unknownTopic++
      return {
        recordId: r.recordId,
        sourceId: FORUM_SOURCE,
        show: FORUM_SHOW,
        status: 'needs_review',
        method: 'official-topic',
        evidence: `topic ${topic ?? '(none)'} not in the collected episode topics`,
        confidence: null,
        reason: 'unknown_topic',
        conversationKey,
        inEra,
        episodeSlug: null,
        seed: true,
      }
    }
    return {
      recordId: r.recordId,
      sourceId: FORUM_SOURCE,
      show: FORUM_SHOW,
      status: 'accepted',
      method: 'official-topic',
      evidence: `topic ${topic} "${t.title}" (official episode discussion)`,
      confidence: 95,
      reason: null,
      conversationKey,
      inEra,
      episodeSlug: t.episode,
      seed: true,
    }
  })

  const workDir = join(ROOT, SOURCES_WORK_DIR)
  await writeJsonl(join(workDir, 'dispositions-forum.jsonl'), dispositions)

  if (!dryRun) {
    const sourceRow = await upsertSource(src)
    const artifactIdByPath = await upsertArtifacts(sourceRow.id, FORUM_SOURCE)
    const recordDbId = await upsertRecords(sourceRow.id, recordInserts)
    await upsertObservations(FORUM_SOURCE, recordDbId, artifactIdByPath, contentByRecord)
    const showIds = await loadShowIds()
    const episodeIds = new Map<string, Map<string, number>>()
    const showId = showIds.get(FORUM_SHOW)
    if (showId !== undefined) episodeIds.set(FORUM_SHOW, await loadEpisodeIds(showId))
    await upsertDispositions(dispositions, recordDbId, showIds, episodeIds)
  }

  // ── summary ────────────────────────────────────────────────────────────────
  const topics: Record<string, TopicSummary> = {}
  for (const [topic, meta] of Object.entries(FORUM_TOPICS)) {
    topics[topic] = {
      title: meta.title,
      episodeSlug: meta.episode,
      records: 0,
      observations: 0,
      firstPostId: null,
      firstPostAt: null,
      lastPostAt: null,
    }
  }
  for (const r of records) {
    const topic = r.threadExternalId
    if (topic === null) continue
    const bucket = topics[topic]
    if (bucket === undefined) continue
    bucket.records++
    bucket.observations += obsCountByRecord.get(r.recordId) ?? 0
    const at = r.postedAt
    if (at !== null) {
      if (bucket.firstPostAt === null || at < bucket.firstPostAt) {
        bucket.firstPostAt = at
        bucket.firstPostId = r.externalId
      }
      if (bucket.lastPostAt === null || at > bucket.lastPostAt) bucket.lastPostAt = at
    }
  }

  const externalById = new Map(records.map((r) => [r.recordId, r.externalId]))
  const duplicateObservations: string[] = []
  for (const [recordId, count] of obsCountByRecord) {
    if (count > 1) {
      const ext = externalById.get(recordId)
      if (ext !== undefined) duplicateObservations.push(ext)
    }
  }
  duplicateObservations.sort()

  const post = records.find((r) => r.externalId === '357190')
  const summary: ForumCatalogSummary = {
    topics,
    records: records.length,
    observations,
    duplicateObservations,
    variants,
    unknownTopic,
    checks: {
      post357190: {
        postedAt: post?.postedAt ?? null,
        datePrecision: post?.datePrecision ?? 'unknown',
        capturedAt: post === undefined ? null : (capturedByRecord.get(post.recordId) ?? null),
        editNotice: post === undefined ? null : (editByRecord.get(post.recordId) ?? null),
      },
    },
  }

  writeJson(join(workDir, 'forum-catalog-summary.json'), summary)
  log(
    `forum: ${summary.records} records, ${summary.observations} observations, ${duplicateObservations.length} duplicated, ` +
      `${unknownTopic} unknown-topic${dryRun ? ' (dry run)' : ''}`
  )
  return summary
}
