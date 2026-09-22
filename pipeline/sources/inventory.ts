// Catalog-layer writers shared by the three catalogers: sources, artifacts,
// source records, observations and dispositions go into Postgres with the same
// batched unnest inserts the legacy loader uses. Every write is idempotent on
// the collection's own ids (source.key, artifact (source, path),
// source_record.record_id, observation.observation_id, record_show pk).
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'
import { ROOT } from '../lib/context'
import { insertRows, inTransaction, withClient, type ColumnSpec } from '../lib/db'
import { readJsonl } from '../lib/checkpoint'
import {
  ORGANIZED_DIR,
  OrganizedArtifact,
  OrganizedObservation,
  OrganizedSource,
  SOURCE_FACTS,
  type Disposition,
  type SourceKind,
} from './types'

const IdRow = z.object({ id: z.number().int() })
const KeyIdRow = z.object({ id: z.number().int(), key: z.string() })
const RecordIdRow = z.object({ id: z.number().int(), record_id: z.string() })
const ShowRow = z.object({ id: z.number().int(), slug: z.string() })
const EpisodeRow = z.object({ id: z.number().int(), slug: z.string() })

export function organizedPath(...parts: string[]): string {
  return join(ROOT, ORGANIZED_DIR, ...parts)
}

export function loadOrganizedSources(): OrganizedSource[] {
  return z.array(OrganizedSource).parse(JSON.parse(readFileSync(organizedPath('sources.json'), 'utf8')))
}

export const OrganizedSummary = z
  .object({
    builtAt: z.string(),
    recordCount: z.number().int(),
    observationCount: z.number().int(),
  })
  .passthrough()
export function loadOrganizedSummary(): z.infer<typeof OrganizedSummary> {
  return OrganizedSummary.parse(JSON.parse(readFileSync(organizedPath('summary.json'), 'utf8')))
}

// ── sources ────────────────────────────────────────────────────────────────

export type SourceRow = { id: number; key: string; kind: SourceKind }

export async function upsertSource(src: OrganizedSource): Promise<SourceRow> {
  const facts = SOURCE_FACTS[src.sourceId]
  if (!facts) throw new Error(`no SOURCE_FACTS entry for ${src.sourceId}`)
  const years = Object.keys(src.years ?? {}).sort()
  const coverageFrom = years[0] ? `${years[0]}-01-01` : null
  const last = years[years.length - 1]
  const coverageTo = last ? `${last}-12-31` : null
  return withClient(async (c) => {
    const res = await c.query(
      `INSERT INTO source (key, kind, name, community_key, home_url, custodian, collection_url, original_status,
         original_checked_at, publication, notes, legacy, record_count, observation_count, coverage_from, coverage_to, date_precision_counts)
       VALUES ($1, $2::"SourceKind", $3, $4, $5, $6, $7, $8::"OriginalStatus", $9, $10::"PublicationStatus", $11, false, $12, $13, $14, $15, $16)
       ON CONFLICT (key) DO UPDATE SET
         name=EXCLUDED.name, community_key=EXCLUDED.community_key, home_url=EXCLUDED.home_url, custodian=EXCLUDED.custodian,
         collection_url=EXCLUDED.collection_url, original_status=EXCLUDED.original_status, original_checked_at=EXCLUDED.original_checked_at,
         publication=EXCLUDED.publication, notes=EXCLUDED.notes, record_count=EXCLUDED.record_count,
         observation_count=EXCLUDED.observation_count, coverage_from=EXCLUDED.coverage_from, coverage_to=EXCLUDED.coverage_to,
         date_precision_counts=EXCLUDED.date_precision_counts
       RETURNING id, key`,
      [
        src.sourceId,
        src.kind,
        src.name,
        facts.communityKey,
        src.homeUrl,
        facts.custodian,
        facts.collectionUrl,
        facts.originalStatus,
        '2026-09-21T00:00:00Z',
        facts.publication,
        src.notes,
        src.records ?? src.recordCount ?? 0,
        src.observations ?? src.observationCount ?? 0,
        coverageFrom,
        coverageTo,
        JSON.stringify(src.datePrecisionCounts ?? {}),
      ]
    )
    const row = KeyIdRow.parse(res.rows[0])
    return { id: row.id, key: row.key, kind: src.kind }
  })
}

export async function sourceIdByKey(key: string): Promise<number> {
  return withClient(async (c) => {
    const res = await c.query('SELECT id FROM source WHERE key = $1', [key])
    const row = res.rows[0]
    if (row === undefined) throw new Error(`source "${key}" is not inventoried yet`)
    return IdRow.parse(row).id
  })
}

// ── artifacts ──────────────────────────────────────────────────────────────

// organized/artifacts.jsonl → artifact rows for one source. Format is inferred
// from the path; retrieval times stay null (the collector did not record them).
export async function upsertArtifacts(sourceId: number, sourceKey: string): Promise<Map<string, number>> {
  const rows: Record<string, unknown>[] = []
  for await (const a of readJsonl(organizedPath('artifacts.jsonl'), OrganizedArtifact)) {
    if (!a.sourceIds.includes(sourceKey)) continue
    const ev = a.collectionEvidence ?? {}
    rows.push({
      source_id: sourceId,
      path: a.artifactPath,
      sha256: a.artifactSha256,
      byte_length: ev.bytes ?? null,
      format: formatOf(a.artifactPath),
      download_url: ev.downloadUrl ?? ev.warcUrl ?? ev.url ?? null,
      custodian: SOURCE_FACTS[sourceKey]?.custodian ?? null,
      captured_at: ev.captureTimestamp ? warcStampToIso(ev.captureTimestamp) : null,
      retrieved_at: null,
      verified_at: ev.verifiedAt ?? null,
    })
  }
  const cols: ColumnSpec[] = [
    { name: 'source_id', type: 'int' },
    { name: 'path', type: 'text' },
    { name: 'sha256', type: 'text' },
    { name: 'byte_length', type: 'bigint' },
    { name: 'format', type: 'text' },
    { name: 'download_url', type: 'text' },
    { name: 'custodian', type: 'text' },
    { name: 'captured_at', type: 'timestamp' },
    { name: 'retrieved_at', type: 'timestamp' },
    { name: 'verified_at', type: 'timestamp' },
  ]
  return inTransaction(async (c) => {
    await insertRows(c, 'artifact', cols, rows, {
      onConflict:
        'ON CONFLICT (source_id, path) DO UPDATE SET sha256=EXCLUDED.sha256, byte_length=EXCLUDED.byte_length, format=EXCLUDED.format, download_url=EXCLUDED.download_url, captured_at=EXCLUDED.captured_at, verified_at=EXCLUDED.verified_at',
    })
    const res = await c.query('SELECT id, path FROM artifact WHERE source_id = $1', [sourceId])
    const out = new Map<string, number>()
    for (const raw of res.rows as unknown[]) {
      const r = z.object({ id: z.number().int(), path: z.string() }).parse(raw)
      out.set(r.path, r.id)
    }
    return out
  })
}

function warcStampToIso(stamp: string): string {
  return `${stamp.slice(0, 4)}-${stamp.slice(4, 6)}-${stamp.slice(6, 8)}T${stamp.slice(8, 10)}:${stamp.slice(10, 12)}:${stamp.slice(12, 14)}Z`
}

function formatOf(path: string): string {
  if (path.endsWith('.mbox.zip')) return 'mbox.zip'
  if (path.endsWith('.mbox')) return 'mbox'
  if (path.endsWith('.warc.gz')) return 'warc.gz'
  if (path.endsWith('.html')) return 'html'
  if (path.endsWith('.txt')) return 'txt'
  return 'other'
}

// ── records ────────────────────────────────────────────────────────────────

export type RecordInsert = {
  record_id: string
  canonical_id: string
  kind: 'post' | 'compiled_document'
  external_id: string
  thread_external_id: string | null
  identity_method: string | null
  original_url: string | null
  title: string
  author_name: string | null
  author_external_id: string | null
  poster_key: string | null
  posted_at: string | null
  posted_date: string | null
  date_precision: 'second' | 'minute' | 'day' | 'unknown'
  date_timezone: string | null
  date_raw: string | null
  date_derivation: string | null
  newsgroups: string[]
  references: string[]
  in_reply_to: string | null
  body: string
  body_length: number
  content_sha256: string
  has_content_conflict: boolean
  is_spam: boolean
  spam_reason: string | null
  metadata: string | null // JSON text
}

const recordCols: ColumnSpec[] = [
  { name: 'source_id', type: 'int' },
  { name: 'record_id', type: 'text' },
  { name: 'canonical_id', type: 'text' },
  { name: 'kind', type: 'ContentKind' },
  { name: 'external_id', type: 'text' },
  { name: 'thread_external_id', type: 'text' },
  { name: 'identity_method', type: 'text' },
  { name: 'original_url', type: 'text' },
  { name: 'title', type: 'text' },
  { name: 'author_name', type: 'text' },
  { name: 'author_external_id', type: 'text' },
  { name: 'poster_key', type: 'text' },
  { name: 'posted_at', type: 'timestamp' },
  { name: 'posted_date', type: 'date' },
  { name: 'date_precision', type: 'DatePrecision' },
  { name: 'date_timezone', type: 'text' },
  { name: 'date_raw', type: 'text' },
  { name: 'date_derivation', type: 'text' },
  { name: 'newsgroups', type: 'text[]' },
  { name: 'references', type: 'text[]' },
  { name: 'in_reply_to', type: 'text' },
  { name: 'body', type: 'text' },
  { name: 'body_length', type: 'int' },
  { name: 'content_sha256', type: 'text' },
  { name: 'has_content_conflict', type: 'boolean' },
  { name: 'is_spam', type: 'boolean' },
  { name: 'spam_reason', type: 'text' },
  { name: 'metadata', type: 'jsonb' },
]

// Time columns are Prisma's default `timestamp` (no zone): pass ISO 'Z' strings
// cast as `timestamp`, never `timestamptz` — the latter converts through the
// session zone and silently shifts every instant (found the hard way).
const RECORD_BATCH = 1000

// Inserts (or refreshes) records for one source, returning record_id → db id.
export async function upsertRecords(sourceId: number, records: Iterable<RecordInsert>): Promise<Map<string, number>> {
  const out = new Map<string, number>()
  let batch: Record<string, unknown>[] = []
  const flush = async (): Promise<void> => {
    if (batch.length === 0) return
    const rows = batch
    batch = []
    await inTransaction(async (c) => {
      const returned = await insertRows(c, 'source_record', recordCols, rows, {
        onConflict:
          'ON CONFLICT (record_id) DO UPDATE SET title=EXCLUDED.title, author_name=EXCLUDED.author_name, poster_key=EXCLUDED.poster_key, posted_at=EXCLUDED.posted_at, posted_date=EXCLUDED.posted_date, date_precision=EXCLUDED.date_precision, body=EXCLUDED.body, body_length=EXCLUDED.body_length, content_sha256=EXCLUDED.content_sha256, has_content_conflict=EXCLUDED.has_content_conflict, is_spam=EXCLUDED.is_spam, spam_reason=EXCLUDED.spam_reason, metadata=EXCLUDED.metadata',
        returning: ['id', 'record_id'],
        returningSchema: RecordIdRow,
      })
      for (const r of returned) out.set(r.record_id, r.id)
    })
  }
  for (const r of records) {
    // Postgres text cannot hold NUL; a handful of binary-ish 1990s posts carry it.
    batch.push({
      source_id: sourceId,
      ...r,
      title: stripNul(r.title),
      author_name: r.author_name === null ? null : stripNul(r.author_name),
      date_raw: r.date_raw === null ? null : stripNul(r.date_raw),
      body: stripNul(r.body),
    })
    if (batch.length >= RECORD_BATCH) await flush()
  }
  await flush()
  return out
}

function stripNul(s: string): string {
  return s.includes(' ') ? s.replaceAll(' ', '') : s
}

export async function recordIdsForSource(sourceId: number): Promise<Map<string, number>> {
  return withClient(async (c) => {
    const out = new Map<string, number>()
    const res = await c.query('SELECT id, record_id FROM source_record WHERE source_id = $1', [sourceId])
    for (const raw of res.rows as unknown[]) {
      const r = RecordIdRow.parse(raw)
      out.set(r.record_id, r.id)
    }
    return out
  })
}

// ── observations ───────────────────────────────────────────────────────────

const observationCols: ColumnSpec[] = [
  { name: 'observation_id', type: 'text' },
  { name: 'record_id', type: 'int' },
  { name: 'artifact_id', type: 'int' },
  { name: 'locator', type: 'text' },
  { name: 'byte_offset', type: 'bigint' },
  { name: 'byte_length', type: 'int' },
  { name: 'original_url', type: 'text' },
  { name: 'captured_page_url', type: 'text' },
  { name: 'captured_at', type: 'timestamp' },
  { name: 'retrieved_at', type: 'timestamp' },
  { name: 'verified_at', type: 'timestamp' },
  { name: 'content_sha256', type: 'text' },
  { name: 'raw_sha256', type: 'text' },
  { name: 'warc_record_id', type: 'text' },
  { name: 'archive_collection_id', type: 'text' },
  { name: 'archive_url', type: 'text' },
  { name: 'differs_from_record', type: 'boolean' },
]

// Streams organized/sources/<key>/observations.jsonl into observation rows.
// `contentByRecord` is record_id → canonical contentSha256, to flag variants.
export async function upsertObservations(
  sourceKey: string,
  recordDbId: Map<string, number>,
  artifactIdByPath: Map<string, number>,
  contentByRecord: Map<string, string>
): Promise<{ inserted: number; variants: number; orphans: number }> {
  let batch: Record<string, unknown>[] = []
  let inserted = 0
  let variants = 0
  let orphans = 0
  const flush = async (): Promise<void> => {
    if (batch.length === 0) return
    const rows = batch
    batch = []
    await inTransaction(async (c) => {
      await insertRows(c, 'observation', observationCols, rows, {
        onConflict:
          'ON CONFLICT (observation_id) DO UPDATE SET captured_at=EXCLUDED.captured_at, retrieved_at=EXCLUDED.retrieved_at, verified_at=EXCLUDED.verified_at, content_sha256=EXCLUDED.content_sha256, differs_from_record=EXCLUDED.differs_from_record',
      })
    })
    inserted += rows.length
  }
  for await (const o of readJsonl(organizedPath('sources', sourceKey, 'observations.jsonl'), OrganizedObservation)) {
    const recordId = recordDbId.get(o.recordId)
    const artifactId = artifactIdByPath.get(o.artifactPath)
    if (recordId === undefined || artifactId === undefined) {
      orphans++
      continue
    }
    const differs = contentByRecord.get(o.recordId) !== o.contentSha256
    if (differs) variants++
    batch.push({
      observation_id: o.observationId,
      record_id: recordId,
      artifact_id: artifactId,
      locator: o.locator,
      byte_offset: o.byteOffset ?? null,
      byte_length: o.byteLength ?? null,
      original_url: o.originalUrl,
      captured_page_url: o.capturedPageUrl ?? null,
      captured_at: o.capturedAt,
      retrieved_at: o.retrievedAt,
      verified_at: o.verifiedAt ?? null,
      content_sha256: o.contentSha256,
      raw_sha256: o.rawSha256 ?? null,
      warc_record_id: o.warcRecordId ?? null,
      archive_collection_id: o.archiveCollectionId ?? null,
      archive_url: o.warcUrl ?? null,
      differs_from_record: differs,
    })
    if (batch.length >= 2000) await flush()
  }
  await flush()
  return { inserted, variants, orphans }
}

// ── dispositions ───────────────────────────────────────────────────────────

const dispositionCols: ColumnSpec[] = [
  { name: 'record_id', type: 'int' },
  { name: 'show_id', type: 'int' },
  { name: 'episode_id', type: 'int' },
  { name: 'status', type: 'AssociationStatus' },
  { name: 'method', type: 'text' },
  { name: 'evidence', type: 'text' },
  { name: 'confidence', type: 'int' },
  { name: 'reason', type: 'text' },
  { name: 'conversation_key', type: 'text' },
  { name: 'in_era', type: 'boolean' },
]

export async function loadShowIds(): Promise<Map<string, number>> {
  return withClient(async (c) => {
    const res = await c.query('SELECT id, slug FROM show')
    return new Map((res.rows as unknown[]).map((r) => ShowRow.parse(r)).map((r) => [r.slug, r.id]))
  })
}

export async function loadEpisodeIds(showId: number): Promise<Map<string, number>> {
  return withClient(async (c) => {
    const res = await c.query('SELECT id, slug FROM episode WHERE show_id = $1', [showId])
    return new Map((res.rows as unknown[]).map((r) => EpisodeRow.parse(r)).map((r) => [r.slug, r.id]))
  })
}

// Writes dispositions for (records, shows); the import later fills
// import_status / message_id. Idempotent on the (record, show) key.
export async function upsertDispositions(
  dispositions: Iterable<Disposition>,
  recordDbId: Map<string, number>,
  showIds: Map<string, number>,
  episodeIds: Map<string, Map<string, number>> // show slug → (episode slug → id)
): Promise<{ written: number; unknownRecords: number }> {
  const rows: Record<string, unknown>[] = []
  let unknownRecords = 0
  for (const d of dispositions) {
    const recordId = recordDbId.get(d.recordId)
    const showId = showIds.get(d.show)
    if (recordId === undefined || showId === undefined) {
      unknownRecords++
      continue
    }
    const episodeId = d.episodeSlug === null ? null : (episodeIds.get(d.show)?.get(d.episodeSlug) ?? null)
    rows.push({
      record_id: recordId,
      show_id: showId,
      episode_id: episodeId,
      status: d.status,
      method: d.method,
      evidence: d.evidence,
      confidence: d.confidence,
      reason: d.reason,
      conversation_key: d.conversationKey,
      in_era: d.inEra,
    })
  }
  await inTransaction(async (c) => {
    for (let i = 0; i < rows.length; i += 2000) {
      await insertRows(c, 'record_show', dispositionCols, rows.slice(i, i + 2000), {
        onConflict:
          'ON CONFLICT (record_id, show_id) DO UPDATE SET episode_id=EXCLUDED.episode_id, status=EXCLUDED.status, method=EXCLUDED.method, evidence=EXCLUDED.evidence, confidence=EXCLUDED.confidence, reason=EXCLUDED.reason, conversation_key=EXCLUDED.conversation_key, in_era=EXCLUDED.in_era, updated_at=now()',
      })
    }
  })
  return { written: rows.length, unknownRecords }
}
