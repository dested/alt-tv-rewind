// Catalog the Simpsons Archive episode capsules: inventory each compiled
// document, map it to an episode by its printed airdate or title, extract its
// attributed contributions, and record one disposition per document. Every
// capsule carries a redistribution notice, so the source is metadata_only:
// contribution text is kept locally and never served (see
// plans/2026-09-21-capsule-provenance.md). Documents are never posts or threads.
import { join } from 'node:path'
import { DATA_DIR, ROOT } from '../lib/context'
import { readJsonl, writeJson, writeJsonl } from '../lib/checkpoint'
import { insertRows, inTransaction, type ColumnSpec } from '../lib/db'
import { readFileSync } from 'node:fs'
import { buildEpisodeIndex, type EpisodeIndex } from '../lib/episode-index'
import { AliasesFile, EpisodesFile } from '../lib/types'
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
import { CAPSULE_SOURCE, CapsuleRecord, SOURCES_WORK_DIR, type CatalogOpts, type Disposition } from './types'
import { resolveCapsuleEpisode } from './capsule-episode'
import { extractContributions, type CapsuleLayout, type ContributionDraft, type ContributionKind } from './capsule-extract'

const CAPSULE_SHOW = 'simpsons'
const DATE_DERIVATION = 'compiled document; contributor posting dates unknown'
const LAYOUTS: CapsuleLayout[] = ['cherry', 'robinson', 'chen', 'unrecognized']

const contributionCols: ColumnSpec[] = [
  { name: 'record_id', type: 'int' },
  { name: 'ordinal', type: 'int' },
  { name: 'section', type: 'text' },
  { name: 'kind', type: 'ContributionKind' },
  { name: 'attribution', type: 'text' },
  { name: 'text', type: 'text' },
  { name: 'text_sha256', type: 'text' },
  { name: 'span_start', type: 'int' },
  { name: 'span_end', type: 'int' },
  { name: 'extraction_status', type: 'text' },
  { name: 'publication', type: 'PublicationStatus' },
]

function sha256(text: string): string {
  return new Bun.CryptoHasher('sha256').update(text).digest('hex')
}

// One record's contributions, upserted on (record_id, ordinal).
export async function insertContributions(recordDbId: number, drafts: ContributionDraft[]): Promise<void> {
  if (drafts.length === 0) return
  const rows = drafts.map((d) => ({
    record_id: recordDbId,
    ordinal: d.ordinal,
    section: d.section,
    kind: d.kind,
    attribution: d.attribution,
    text: d.text,
    text_sha256: sha256(d.text),
    span_start: d.spanStart,
    span_end: d.spanEnd,
    extraction_status: 'extracted',
    publication: 'metadata_only',
  }))
  await inTransaction(async (c) => {
    await insertRows(c, 'contribution', contributionCols, rows, {
      onConflict:
        'ON CONFLICT (record_id, ordinal) DO UPDATE SET section=EXCLUDED.section, kind=EXCLUDED.kind, attribution=EXCLUDED.attribution, text=EXCLUDED.text, text_sha256=EXCLUDED.text_sha256, span_start=EXCLUDED.span_start, span_end=EXCLUDED.span_end',
    })
  })
}

function loadEpisodeIndex(): EpisodeIndex {
  const episodes = EpisodesFile.parse(JSON.parse(readFileSync(join(DATA_DIR, 'shows', CAPSULE_SHOW, 'episodes.json'), 'utf8')))
  const aliases = AliasesFile.parse(JSON.parse(readFileSync(join(DATA_DIR, 'shows', CAPSULE_SHOW, 'aliases.json'), 'utf8')))
  return buildEpisodeIndex(episodes, aliases)
}

type Extraction = { layout: CapsuleLayout; drafts: ContributionDraft[]; extractionStatus: string }

export type CapsuleCatalogSummary = {
  documents: number
  byLayout: Record<CapsuleLayout, number>
  unrecognized: string[]
  mapping: {
    airdate: number
    title: number
    unresolved: Array<{ externalId: string; title: string; reason: string | null }>
  }
  contributions: {
    total: number
    byKind: Record<string, number>
    attributed: number
    unattributed: number
    documentsWithNone: string[]
  }
  checks: {
    '2F09.html': {
      episodeKey: string | null
      reviews: number
      attributions: string[]
      airDateRaw: string | null
      revisionRaw: string | null
      postingDatesAssigned: 0
    }
    '9F10.html': {
      episodeKey: string | null
      method: string | null
      conversionDateRaw: string | null
      postingDatesAssigned: 0
    }
  }
}

export async function catalogCapsules(opts: CatalogOpts): Promise<CapsuleCatalogSummary> {
  const { log, dryRun } = opts
  const restricted = opts.sources !== undefined
  const src = loadOrganizedSources().find((s) => s.sourceId === CAPSULE_SOURCE)
  if (src === undefined) throw new Error(`no organized source "${CAPSULE_SOURCE}"`)
  const index = loadEpisodeIndex()
  const slugByKey = new Map<string, string>()
  for (const [key, ep] of index.byKey) slugByKey.set(key, ep.slug)

  const records: CapsuleRecord[] = []
  for await (const r of readJsonl(organizedPath('sources', CAPSULE_SOURCE, 'records.jsonl'), CapsuleRecord)) {
    records.push(r)
  }
  if (!restricted && records.length !== 281) {
    throw new Error(`capsule records ${records.length} !== 281 (unexpected bundle)`)
  }
  const contentByRecord = new Map(records.map((r) => [r.recordId, r.contentSha256]))

  const extraction = new Map<string, Extraction>()
  const recordInserts: RecordInsert[] = []
  const dispositions: Disposition[] = []

  const byLayout: Record<CapsuleLayout, number> = { cherry: 0, robinson: 0, chen: 0, unrecognized: 0 }
  const unrecognized: string[] = []
  let airdateCount = 0
  let titleCount = 0
  const unresolved: Array<{ externalId: string; title: string; reason: string | null }> = []

  for (const r of records) {
    const { layout, contributions } = extractContributions(r.bodyText)
    const extractionStatus = layout === 'unrecognized' ? 'unrecognized_layout' : 'extracted'
    extraction.set(r.recordId, { layout, drafts: contributions, extractionStatus })
    byLayout[layout]++
    if (layout === 'unrecognized') unrecognized.push(r.externalId)

    const meta = r.documentMetadata
    const productionCode = meta.productionCode ?? null
    const resolved = resolveCapsuleEpisode({ title: r.title, body: r.bodyText, productionCode }, index)

    recordInserts.push({
      record_id: r.recordId,
      canonical_id: r.canonicalId,
      kind: 'compiled_document',
      external_id: r.externalId,
      thread_external_id: r.threadExternalId,
      identity_method: 'filename',
      original_url: r.originalUrl,
      title: r.title,
      author_name: null,
      author_external_id: null,
      poster_key: null,
      posted_at: null,
      posted_date: null,
      date_precision: 'unknown',
      date_timezone: null,
      date_raw: null,
      date_derivation: DATE_DERIVATION,
      newsgroups: [],
      references: [],
      in_reply_to: null,
      body: r.bodyText,
      body_length: r.bodyText.length,
      content_sha256: r.contentSha256,
      has_content_conflict: false,
      is_spam: false,
      spam_reason: null,
      metadata: JSON.stringify({
        ...meta,
        sourceFormat: r.sourceFormat,
        sourceEncoding: r.sourceEncoding,
        publicationStatus: r.publicationStatus,
        replacementCharacterCount: r.replacementCharacterCount,
        layout,
        extractionStatus,
      }),
    })

    // Documents are undated: inEra is always true, no conversation, seed true.
    if (resolved.episodeKey !== null && resolved.method !== null) {
      if (resolved.method === 'capsule-airdate') airdateCount++
      else titleCount++
      const airRaw = meta.originalAirDate?.raw ?? null
      const cleanTitle = r.title.replace(/^\[[0-9A-Za-z]+\]\s*/, '').trim()
      const evidence =
        resolved.method === 'capsule-airdate'
          ? `airdate ${airRaw ?? '?'} → ${resolved.episodeKey}`
          : `title "${cleanTitle}" → ${resolved.episodeKey}`
      dispositions.push({
        recordId: r.recordId,
        sourceId: CAPSULE_SOURCE,
        show: CAPSULE_SHOW,
        status: 'accepted',
        method: resolved.method,
        evidence,
        confidence: resolved.method === 'capsule-airdate' ? 95 : 80,
        reason: null,
        conversationKey: null,
        inEra: true,
        episodeSlug: slugByKey.get(resolved.episodeKey) ?? null,
        seed: true,
      })
    } else {
      unresolved.push({ externalId: r.externalId, title: r.title, reason: resolved.reason })
      dispositions.push({
        recordId: r.recordId,
        sourceId: CAPSULE_SOURCE,
        show: CAPSULE_SHOW,
        status: 'needs_review',
        method: 'capsule-title',
        evidence: `unresolved: ${r.title}`,
        confidence: null,
        reason: resolved.reason,
        conversationKey: null,
        inEra: true,
        episodeSlug: null,
        seed: true,
      })
    }
  }

  const workDir = join(ROOT, SOURCES_WORK_DIR)
  await writeJsonl(join(workDir, 'dispositions-capsules.jsonl'), dispositions)

  if (!dryRun) {
    const sourceRow = await upsertSource(src)
    const artifactIdByPath = await upsertArtifacts(sourceRow.id, CAPSULE_SOURCE)
    const recordDbId = await upsertRecords(sourceRow.id, recordInserts)
    await upsertObservations(CAPSULE_SOURCE, recordDbId, artifactIdByPath, contentByRecord)
    for (const r of records) {
      const dbId = recordDbId.get(r.recordId)
      const ex = extraction.get(r.recordId)
      if (dbId !== undefined && ex !== undefined) await insertContributions(dbId, ex.drafts)
    }
    const showIds = await loadShowIds()
    const episodeIds = new Map<string, Map<string, number>>()
    const showId = showIds.get(CAPSULE_SHOW)
    if (showId !== undefined) episodeIds.set(CAPSULE_SHOW, await loadEpisodeIds(showId))
    await upsertDispositions(dispositions, recordDbId, showIds, episodeIds)
  }

  // ── summary ────────────────────────────────────────────────────────────────
  const byKind: Record<string, number> = {}
  let total = 0
  let attributed = 0
  let unattributed = 0
  const documentsWithNone: string[] = []
  for (const r of records) {
    const ex = extraction.get(r.recordId)
    if (ex === undefined || ex.drafts.length === 0) {
      documentsWithNone.push(r.externalId)
      continue
    }
    for (const d of ex.drafts) {
      total++
      byKind[d.kind] = (byKind[d.kind] ?? 0) + 1
      if (d.attribution !== null) attributed++
      else unattributed++
    }
  }

  const check = (externalId: string) => records.find((r) => r.externalId === externalId)
  const rec2F09 = check('2F09.html')
  const rec9F10 = check('9F10.html')
  const ex2F09 = rec2F09 ? extraction.get(rec2F09.recordId) : undefined
  const reviews2F09 = ex2F09 ? ex2F09.drafts.filter((d) => d.kind === 'review') : []
  const res2F09 = rec2F09
    ? resolveCapsuleEpisode(
        { title: rec2F09.title, body: rec2F09.bodyText, productionCode: rec2F09.documentMetadata.productionCode ?? null },
        index
      )
    : null
  const res9F10 = rec9F10
    ? resolveCapsuleEpisode(
        { title: rec9F10.title, body: rec9F10.bodyText, productionCode: rec9F10.documentMetadata.productionCode ?? null },
        index
      )
    : null

  const summary: CapsuleCatalogSummary = {
    documents: records.length,
    byLayout,
    unrecognized,
    mapping: { airdate: airdateCount, title: titleCount, unresolved },
    contributions: { total, byKind, attributed, unattributed, documentsWithNone },
    checks: {
      '2F09.html': {
        episodeKey: res2F09?.episodeKey ?? null,
        reviews: reviews2F09.length,
        attributions: reviews2F09
          .map((d) => d.attribution)
          .filter((a): a is string => a !== null)
          .slice(0, 12),
        airDateRaw: rec2F09?.documentMetadata.originalAirDate?.raw ?? null,
        revisionRaw: rec2F09?.documentMetadata.revision?.raw ?? null,
        postingDatesAssigned: 0,
      },
      '9F10.html': {
        episodeKey: res9F10?.episodeKey ?? null,
        method: res9F10?.method ?? null,
        conversionDateRaw: rec9F10?.documentMetadata.conversionDate?.raw ?? null,
        postingDatesAssigned: 0,
      },
    },
  }

  writeJson(join(workDir, 'capsule-catalog-summary.json'), summary)
  const layoutStr = LAYOUTS.map((l) => `${l}=${byLayout[l]}`).join(' ')
  log(
    `capsules: ${summary.documents} documents (${layoutStr}); mapped airdate=${airdateCount} title=${titleCount} ` +
      `unresolved=${unresolved.length}; contributions=${total}${dryRun ? ' (dry run)' : ''}`
  )
  return summary
}
