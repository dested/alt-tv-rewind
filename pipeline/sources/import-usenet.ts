// Usenet projection: turn one show's accepted/context Usenet records into
// thread/message rows the site serves. Mirrors pipeline/stages/load.ts (same
// column specs, slug SQL, thread_episode rule, ANALYZE) but is additive and
// idempotent: a conversation that shares a Message-ID with an existing legacy
// thread joins it (messages appended, slug untouched); a re-run inserts nothing
// new; a legacy thread's slug is never recomputed. `message.search` is a DB
// trigger and is never written here. Reads go through pipeline/lib/db.ts so a
// catalog run may proceed in the same DB; dry runs touch no row.
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { z } from 'zod'
import { insertRows, inTransaction, withClient, type ColumnSpec } from '../lib/db'
import { checkpointExists, readJsonl, writeJson, writeJsonl } from '../lib/checkpoint'
import { airDateMs } from '../lib/episode-index'
import { countLines, normalizeSubject, posterKey } from '../lib/normalize'
import { withoutQuotedLines } from '../lib/text'
import { scoreThread, type ThreadText } from '../lib/scoring'
import {
  CandidateRecord,
  ClassifiedRecord,
  EnrichedRecord,
  ThreadRecord,
  ThreadedMessage,
} from '../lib/types'
import type { ImportContext } from './import'
import {
  Conversation,
  DatePrecision,
  InputFingerprint,
  type Conversation as ConversationT,
} from './types'
import {
  chooseThread,
  mapDates,
  memberFate,
  projectThread,
  threadRelation,
  type LegacyMessage,
  type MemberFate,
  type ProjectionMember,
} from './projection'

// Attribution constants — identical to pipeline/stages/attribute.ts so the
// candidates the classify stage reads score the same whether they came from the
// legacy pipeline or from here.
const ROOT_LIMIT = 3000
const REPLY_LIMIT = 1500
const MAX_REPLIES = 2

export type ImportUsenetSummary = {
  sources: Record<string, { archiveId: number | null; recordsInScope: number }>
  conversations: { inScope: number; joinedLegacy: number; newThreads: number }
  messages: { inserted: number; linked: number; alreadyImported: number; longBodies: number; inheritedDates: number }
  memberships: { primary: number; additional: number }
  posters: { new: number }
  threadEpisodes: { llm: number; heuristic: number; live: number; retro: number; unattributed: number }
  touchedThreads: number
  durationMs: number
}

// ── DB row schemas (every returned row crosses a zod boundary) ───────────────

const RecordMetaRow = z.object({
  id: z.number().int(),
  record_id: z.string(),
  canonical_id: z.string(),
  external_id: z.string(),
  source_id: z.number().int(),
  title: z.string(),
  author_name: z.string().nullable(),
  poster_key: z.string().nullable(),
  date_precision: DatePrecision,
  references: z.array(z.string()),
  status: z.enum(['accepted', 'context']),
  conversation_key: z.string().nullable(),
})
type RecordMeta = z.infer<typeof RecordMetaRow>

const LegacyRow = z.object({
  id: z.number().int(),
  message_id: z.string(),
  thread_id: z.number().int(),
  depth: z.number().int(),
  source_record_id: z.number().int().nullable(),
})
const ThreadMetaRow = z.object({ id: z.number().int(), import_key: z.string().nullable() })
const IdRow = z.object({ id: z.number().int() })
const ArtifactPathRow = z.object({ path: z.string() })
const PosterKeyRow = z.object({ id: z.number().int(), key: z.string() })
const MessageIdRow = z.object({ id: z.number().int(), message_id: z.string(), archive_id: z.number().int() })
const ThreadIdSlugRow = z.object({ id: z.number().int(), slug: z.string() })

// message columns = load.ts messageCols + date_precision + source_record_id.
const messageCols: ColumnSpec[] = [
  { name: 'archive_id', type: 'int' },
  { name: 'thread_id', type: 'int' },
  { name: 'poster_id', type: 'int' },
  { name: 'parent_ref', type: 'text' },
  { name: 'depth', type: 'int' },
  { name: 'message_id', type: 'text' },
  { name: 'subject', type: 'text' },
  { name: 'posted_at', type: 'timestamp' },
  { name: 'body', type: 'text' },
  { name: 'line_count', type: 'int' },
  { name: 'is_spam', type: 'boolean' },
  { name: 'date_only', type: 'boolean' },
  { name: 'date_precision', type: 'DatePrecision' },
  { name: 'source_record_id', type: 'int' },
]

const threadCols: ColumnSpec[] = [
  { name: 'show_id', type: 'int' },
  { name: 'archive_id', type: 'int' },
  { name: 'import_key', type: 'text' },
  { name: 'slug', type: 'text' },
  { name: 'subject', type: 'text' },
  { name: 'started_at', type: 'timestamp' },
  { name: 'started_date_only', type: 'boolean' },
  { name: 'last_post_at', type: 'timestamp' },
  { name: 'message_count', type: 'int' },
  { name: 'poster_count', type: 'int' },
  { name: 'max_depth', type: 'int' },
  { name: 'is_spam', type: 'boolean' },
]

const messageSourceCols: ColumnSpec[] = [
  { name: 'message_id', type: 'int' },
  { name: 'record_id', type: 'int' },
  { name: 'role', type: 'text' },
]

const posterCols: ColumnSpec[] = [
  { name: 'key', type: 'text' },
  { name: 'display_name', type: 'text' },
]

const teCols: ColumnSpec[] = [
  { name: 'thread_id', type: 'int' },
  { name: 'episode_id', type: 'int' },
  { name: 'relation', type: 'EpisodeRelation' },
  { name: 'confidence', type: 'int' },
  { name: 'method', type: 'text' },
  { name: 'is_primary', type: 'boolean' },
]

// ── in-memory plan (built before any write) ──────────────────────────────────

type PlannedMember = {
  externalId: string
  record: RecordMeta // chosen in-scope record (lowest source order)
  additionalRecordIds: number[] // other in-scope records of this member (db ids)
  canonicalId: string
  parentCanonicalId: string | null
  references: string[]
  depth: number // conversation depth (checkpoint structure)
  sortAt: string
  inheritedDate: boolean
  fate: MemberFate
  legacyId: number | null // legacy/prior-import message id when fate != 'insert'
  parentRef: string | null // resolved parent Message-ID for the inserted row
}

type PlannedConversation = {
  key: string
  earliestAt: string
  members: PlannedMember[]
  archiveSourceId: number // earliest member's record source id → thread archive
  threadId: number | null // resolved (existing) or created; null in dry run for new threads
  isImportThread: boolean // gets checkpoints + attribution + slug rewrite
  joinedLegacy: boolean
}

export async function importUsenet(ctx: ImportContext): Promise<ImportUsenetSummary> {
  const started = Date.now()
  const usenetSources = ctx.sources.filter((s) => s.kind === 'usenet')
  const sourceKeyById = new Map(usenetSources.map((s) => [s.id, s.key]))
  const sourceIds = usenetSources.map((s) => s.id)

  const summary: ImportUsenetSummary = {
    sources: Object.fromEntries(usenetSources.map((s) => [s.key, { archiveId: null, recordsInScope: 0 }])),
    conversations: { inScope: 0, joinedLegacy: 0, newThreads: 0 },
    messages: { inserted: 0, linked: 0, alreadyImported: 0, longBodies: 0, inheritedDates: 0 },
    memberships: { primary: 0, additional: 0 },
    posters: { new: 0 },
    threadEpisodes: { llm: 0, heuristic: 0, live: 0, retro: 0, unattributed: 0 },
    touchedThreads: 0,
    durationMs: 0,
  }
  if (usenetSources.length === 0) {
    summary.durationMs = Date.now() - started
    return summary
  }

  // ── fingerprint gate ───────────────────────────────────────────────────────
  const sourcesRoot = dirname(ctx.workDir)
  const globalFingerprintPath = join(sourcesRoot, 'fingerprint.json')
  if (!existsSync(globalFingerprintPath)) {
    throw new Error(`missing ${globalFingerprintPath} — run \`pipeline sources catalog\` first`)
  }
  const globalFingerprint = InputFingerprint.parse(JSON.parse(readFileSync(globalFingerprintPath, 'utf8')))
  const showFingerprintPath = join(ctx.workDir, 'fingerprint.json')
  if (existsSync(showFingerprintPath) && !ctx.force) {
    const prior = InputFingerprint.parse(JSON.parse(readFileSync(showFingerprintPath, 'utf8')))
    if (
      prior.organizedBuiltAt !== globalFingerprint.organizedBuiltAt ||
      prior.extractorVersion !== globalFingerprint.extractorVersion
    ) {
      throw new Error(
        `${ctx.show.slug}: catalog inputs changed since the last import (${prior.organizedBuiltAt}/${prior.extractorVersion} → ${globalFingerprint.organizedBuiltAt}/${globalFingerprint.extractorVersion}); re-run with --force`
      )
    }
  }

  // ── in-scope records (metadata; bodies fetched later, bounded) ─────────────
  const records = await withClient(async (c) => {
    const res = await c.query(
      `SELECT r.id, r.record_id, r.canonical_id, r.external_id, r.source_id, r.title,
              r.author_name, r.poster_key, r.date_precision, r.references,
              rs.status, rs.conversation_key
       FROM record_show rs
       JOIN source_record r ON r.id = rs.record_id
       WHERE rs.show_id = $1 AND rs.status IN ('accepted','context')
         AND r.kind = 'post' AND NOT r.is_spam AND r.source_id = ANY($2)`,
      [ctx.showId, sourceIds]
    )
    return (res.rows as unknown[]).map((row) => RecordMetaRow.parse(row))
  })
  const recordByCollectionId = new Map<string, RecordMeta>()
  for (const r of records) {
    recordByCollectionId.set(r.record_id, r)
    const key = sourceKeyById.get(r.source_id)
    if (key !== undefined) {
      const s = summary.sources[key]
      if (s !== undefined) s.recordsInScope++
    }
  }
  ctx.log(`in-scope records: ${records.length} across ${usenetSources.length} source(s)`)

  // ── conversations for this show (only keys the in-scope records name) ───────
  const wantedKeys = new Set<string>()
  for (const r of records) if (r.conversation_key !== null) wantedKeys.add(r.conversation_key)
  const conversationsPath = join(sourcesRoot, 'conversations.jsonl')
  if (!existsSync(conversationsPath)) {
    throw new Error(`missing ${conversationsPath} — run \`pipeline sources catalog\` first`)
  }
  const conversations: ConversationT[] = []
  for await (const conv of readJsonl(conversationsPath, Conversation)) {
    if (wantedKeys.has(conv.key)) conversations.push(conv)
  }
  conversations.sort((a, b) => (a.earliestAt < b.earliestAt ? -1 : a.earliestAt > b.earliestAt ? 1 : a.key < b.key ? -1 : 1))

  // ── legacy index for the show ──────────────────────────────────────────────
  const legacy = new Map<string, LegacyMessage>()
  const legacyByThread = new Map<number, Map<string, number>>() // threadId → (messageId → depth)
  const threadImportKey = new Map<number, string | null>()
  await withClient(async (c) => {
    const res = await c.query(
      `SELECT m.id, m.message_id, m.thread_id, m.depth, m.source_record_id
       FROM message m JOIN archive a ON a.id = m.archive_id WHERE a.show_id = $1`,
      [ctx.showId]
    )
    for (const raw of res.rows as unknown[]) {
      const r = LegacyRow.parse(raw)
      legacy.set(r.message_id, {
        id: r.id,
        messageId: r.message_id,
        threadId: r.thread_id,
        depth: r.depth,
        sourceRecordId: r.source_record_id,
      })
      let byThread = legacyByThread.get(r.thread_id)
      if (byThread === undefined) {
        byThread = new Map()
        legacyByThread.set(r.thread_id, byThread)
      }
      byThread.set(r.message_id, r.depth)
    }
    const tRes = await c.query('SELECT id, import_key FROM thread WHERE show_id = $1', [ctx.showId])
    for (const raw of tRes.rows as unknown[]) {
      const r = ThreadMetaRow.parse(raw)
      threadImportKey.set(r.id, r.import_key)
    }
  })

  // ── archives (one per usenet source; additive, never deleted) ──────────────
  const archiveIdBySource = new Map<number, number>()
  if (!ctx.dryRun) {
    await inTransaction(async (c) => {
      for (const src of usenetSources) {
        const artRes = await c.query('SELECT path FROM artifact WHERE source_id = $1 ORDER BY id LIMIT 1', [src.id])
        const artRow = artRes.rows[0]
        const sourceFile = artRow === undefined ? src.community_key : basename(ArtifactPathRow.parse(artRow).path)
        const res = await c.query(
          `INSERT INTO archive (show_id, source_id, newsgroup, source_file)
           VALUES ($1,$2,$3,$4)
           ON CONFLICT (show_id, newsgroup) DO UPDATE SET source_id = EXCLUDED.source_id, ingested_at = now()
           RETURNING id`,
          [ctx.showId, src.id, src.community_key, sourceFile]
        )
        const id = IdRow.parse(res.rows[0]).id
        archiveIdBySource.set(src.id, id)
        const s = summary.sources[src.key]
        if (s !== undefined) s.archiveId = id
      }
    })
  }

  // ── plan every conversation (no writes) ────────────────────────────────────
  const plans: PlannedConversation[] = []
  const inScope = (recordId: string): RecordMeta | undefined => {
    const rec = recordByCollectionId.get(recordId)
    return rec !== undefined && (rec.status === 'accepted' || rec.status === 'context') ? rec : undefined
  }

  for (const conv of conversations) {
    const members: PlannedMember[] = []
    const externalIdByCanonical = new Map<string, string>()

    for (const m of conv.members) {
      const scoped: RecordMeta[] = []
      for (const rid of [m.recordId, ...m.additionalRecordIds]) {
        const rec = inScope(rid)
        if (rec !== undefined) scoped.push(rec)
      }
      if (scoped.length === 0) continue
      scoped.sort((a, b) => a.source_id - b.source_id) // lowest source order wins
      const record = scoped[0]
      if (record === undefined) continue
      const additionalRecordIds = scoped.slice(1).map((r) => r.id)
      const fate = memberFate(record.external_id, record.id, legacy)
      const legacyId = legacy.get(record.external_id)?.id ?? null
      members.push({
        externalId: record.external_id,
        record,
        additionalRecordIds,
        canonicalId: m.canonicalId,
        parentCanonicalId: m.parentCanonicalId,
        references: record.references,
        depth: m.depth,
        sortAt: m.sortAt,
        inheritedDate: m.inheritedDate,
        fate,
        legacyId,
        parentRef: null,
      })
      externalIdByCanonical.set(m.canonicalId, record.external_id)
    }
    if (members.length === 0) continue
    members.sort((a, b) => (a.sortAt < b.sortAt ? -1 : a.sortAt > b.sortAt ? 1 : a.externalId < b.externalId ? -1 : 1))
    summary.conversations.inScope++

    // Which thread does this conversation occupy?
    const chosen = chooseThread(members.map((mm) => mm.externalId), legacy)
    const earliest = members[0]
    if (earliest === undefined) continue
    const archiveSourceId = earliest.record.source_id

    let threadId: number | null = null
    let isImportThread: boolean
    let joinedLegacy = false
    if (chosen !== null && threadImportKey.get(chosen) === conv.key) {
      // Our own thread from a previous run.
      threadId = chosen
      isImportThread = true
    } else if (chosen !== null) {
      // A legacy thread (or a re-run whose import_key differs): join it.
      threadId = chosen
      isImportThread = false
      joinedLegacy = true
    } else {
      isImportThread = true
    }

    // Recompute parent_ref / depth for the members we will insert, against the
    // target thread's legacy rows (empty for a brand-new import thread).
    const targetLegacyDepth = threadId !== null ? (legacyByThread.get(threadId) ?? new Map<string, number>()) : new Map<string, number>()
    const toInsert: ProjectionMember[] = members
      .filter((mm) => mm.fate === 'insert')
      .map((mm) => ({
        externalId: mm.externalId,
        canonicalId: mm.canonicalId,
        parentCanonicalId: mm.parentCanonicalId,
        references: mm.references,
      }))
    const projected = projectThread(toInsert, externalIdByCanonical, targetLegacyDepth)
    // Stash projected parent/depth back onto planned members for the insert pass.
    for (const mm of members) {
      const p = projected.get(mm.externalId)
      if (p !== undefined) {
        mm.depth = p.depth
        mm.parentRef = p.parentRef
      }
    }

    plans.push({ key: conv.key, earliestAt: conv.earliestAt, members, archiveSourceId, threadId, isImportThread, joinedLegacy })
    if (joinedLegacy) summary.conversations.joinedLegacy++
    else summary.conversations.newThreads++
  }

  // ── bodies (only what we insert or must checkpoint) ─────────────────────────
  const neededBodyIds = new Set<number>()
  for (const plan of plans) {
    for (const mm of plan.members) {
      if (mm.fate === 'insert') neededBodyIds.add(mm.record.id)
      if (plan.isImportThread) neededBodyIds.add(mm.record.id)
    }
  }
  const bodyById = new Map<number, string>()
  if (neededBodyIds.size > 0) {
    const ids = [...neededBodyIds]
    await withClient(async (c) => {
      for (let i = 0; i < ids.length; i += 2000) {
        const chunk = ids.slice(i, i + 2000)
        const res = await c.query('SELECT id, body FROM source_record WHERE id = ANY($1)', [chunk])
        for (const raw of res.rows as unknown[]) {
          const r = z.object({ id: z.number().int(), body: z.string() }).parse(raw)
          bodyById.set(r.id, r.body)
        }
      }
    })
  }
  const bodyOf = (id: number): string => bodyById.get(id) ?? ''

  // ── checkpoints for import threads (threads/threaded/candidates) ────────────
  mkdirSync(ctx.workDir, { recursive: true })
  const importPlans = plans.filter((p) => p.isImportThread)
  const candidatesByKey = new Map<string, CandidateRecord>()

  const threadRecords: ThreadRecord[] = []
  const threadedRecords: ThreadedMessage[] = []
  const candidateRecords: CandidateRecord[] = []

  for (const plan of importPlans) {
    const earliest = plan.members[0]
    if (earliest === undefined) continue
    const subjectDisplay = normalizeSubject(earliest.record.title).display
    const startedDateOnly = earliest.record.date_precision === 'day' || earliest.inheritedDate

    // Root = earliest depth-0 member (conversation structure).
    let rootExternalId: string | null = null
    let rootSortAt: string | null = null
    let maxDepth = 0
    const posterKeys = new Set<string>()
    let lastPostAt = plan.earliestAt
    for (const mm of plan.members) {
      if (mm.depth > maxDepth) maxDepth = mm.depth
      posterKeys.add(mm.record.poster_key ?? posterKey(null, mm.record.author_name ?? 'unknown'))
      if (mm.sortAt > lastPostAt) lastPostAt = mm.sortAt
      if (mm.depth === 0 && (rootSortAt === null || mm.sortAt < rootSortAt)) {
        rootSortAt = mm.sortAt
        rootExternalId = mm.externalId
      }
    }

    threadRecords.push({
      threadKey: plan.key,
      rootMessageId: rootExternalId,
      subject: subjectDisplay,
      subjectNorm: normalizeSubject(earliest.record.title).norm,
      startedAt: plan.earliestAt,
      startedDateOnly,
      lastPostAt,
      messageCount: plan.members.length,
      posterCount: posterKeys.size,
      maxDepth,
      isSpam: false,
    })

    // Threaded messages (parent = parent member's Message-ID; depth = structure).
    for (const mm of plan.members) {
      const { dateOnly } = mapDates(mm.record.date_precision, mm.inheritedDate)
      const parentRef = mm.parentCanonicalId !== null ? externalIdByCanonicalFor(plan, mm.parentCanonicalId) : null
      const pKey = mm.record.poster_key ?? posterKey(null, mm.record.author_name ?? 'unknown')
      const body = bodyOf(mm.record.id)
      threadedRecords.push({
        messageId: mm.externalId,
        subject: mm.record.title,
        subjectNorm: normalizeSubject(mm.record.title).norm,
        fromName: mm.record.author_name ?? 'unknown',
        posterKey: pKey,
        postedAt: mm.sortAt,
        dateOnly,
        references: mm.references,
        inReplyTo: null,
        newsgroups: [],
        body,
        lineCount: countLines(body),
        isSpam: false,
        spamReason: null,
        threadKey: plan.key,
        parentRef,
        depth: mm.depth,
      })
    }

    // Candidates — scored exactly like the attribute stage.
    const text = buildThreadText(plan, bodyOf)
    const scored = scoreThread(plan.earliestAt, text, ctx.index, ctx.liveWindowDays)
    const cand: CandidateRecord = { threadKey: plan.key, candidates: scored.candidates, inLiveWindow: scored.inLiveWindow }
    candidateRecords.push(cand)
    candidatesByKey.set(plan.key, cand)
  }

  await writeJsonl(join(ctx.workDir, 'threads.jsonl'), threadRecords)
  await writeJsonl(join(ctx.workDir, 'threaded.jsonl'), threadedRecords)
  await writeJsonl(join(ctx.workDir, 'candidates.jsonl'), candidateRecords)
  ctx.log(`checkpoints: ${threadRecords.length} threads, ${threadedRecords.length} messages, ${candidateRecords.length} candidates`)

  // Count messages, memberships and touched threads — the same in dry and real
  // runs, so the dry-run summary states exactly what a real run would do.
  const wouldTouch = new Set<string>()
  const insertPosterName = new Map<string, string>()
  for (const plan of plans) {
    let hasInsert = false
    for (const mm of plan.members) {
      if (mm.fate === 'insert') {
        summary.messages.inserted++
        hasInsert = true
        if (bodyOf(mm.record.id).length > 65536) summary.messages.longBodies++
        if (mm.inheritedDate) summary.messages.inheritedDates++
        const key = mm.record.poster_key ?? posterKey(null, mm.record.author_name ?? 'unknown')
        if (!insertPosterName.has(key)) insertPosterName.set(key, mm.record.author_name ?? 'unknown')
      } else if (mm.fate === 'linked') {
        summary.messages.linked++
      } else {
        summary.messages.alreadyImported++
      }
      if (mm.fate === 'linked') {
        summary.memberships.additional += 1 + mm.additionalRecordIds.length
      } else {
        summary.memberships.primary += 1
        summary.memberships.additional += mm.additionalRecordIds.length
      }
    }
    if (hasInsert) wouldTouch.add(plan.threadId !== null ? `t${plan.threadId}` : `k${plan.key}`)
  }
  summary.touchedThreads = wouldTouch.size

  // Posters that would be created — a read, safe to run in either mode.
  if (insertPosterName.size > 0) {
    const keys = [...insertPosterName.keys()]
    await withClient(async (c) => {
      const before = await c.query('SELECT id, key FROM poster WHERE key = ANY($1)', [keys])
      const existing = new Set((before.rows as unknown[]).map((r) => PosterKeyRow.parse(r).key))
      summary.posters.new = keys.filter((k) => !existing.has(k)).length
    })
  }

  // ── writes (real run only) ─────────────────────────────────────────────────
  const touchedThreadIds = new Set<number>()
  const importThreadIds = new Set<number>()

  if (!ctx.dryRun) {
    // 1. Create thread rows for brand-new import threads.
    const newPlans = importPlans.filter((p) => p.threadId === null)
    if (newPlans.length > 0) {
      const rows = newPlans.map((plan) => {
        const earliest = plan.members[0]
        const title = earliest?.record.title ?? '(no subject)'
        const startedDateOnly = earliest !== undefined && (earliest.record.date_precision === 'day' || earliest.inheritedDate)
        let last = plan.earliestAt
        const posterKeys = new Set<string>()
        let maxDepth = 0
        for (const mm of plan.members) {
          if (mm.sortAt > last) last = mm.sortAt
          if (mm.depth > maxDepth) maxDepth = mm.depth
          posterKeys.add(mm.record.poster_key ?? posterKey(null, mm.record.author_name ?? 'unknown'))
        }
        return {
          show_id: ctx.showId,
          archive_id: archiveIdBySource.get(plan.archiveSourceId) ?? null,
          import_key: plan.key,
          slug: `~${plan.key}`,
          subject: normalizeSubject(title).display,
          started_at: plan.earliestAt,
          started_date_only: startedDateOnly,
          last_post_at: last,
          message_count: plan.members.length,
          poster_count: posterKeys.size,
          max_depth: maxDepth,
          is_spam: false,
        }
      })
      await inTransaction(async (c) => {
        const returned = await insertRows(c, 'thread', threadCols, rows, {
          returning: ['id', 'slug'],
          returningSchema: ThreadIdSlugRow,
          onConflict: 'ON CONFLICT (show_id, import_key) DO UPDATE SET last_post_at = EXCLUDED.last_post_at',
        })
        newPlans.forEach((plan, i) => {
          const r = returned[i]
          if (r !== undefined) plan.threadId = r.id
        })
      })
    }
    for (const plan of importPlans) if (plan.threadId !== null) importThreadIds.add(plan.threadId)

    // 2. Posters for the messages we insert (count already in summary).
    const posterIdByKey = new Map<string, number>()
    if (insertPosterName.size > 0) {
      const keys = [...insertPosterName.keys()]
      await inTransaction(async (c) => {
        await insertRows(
          c,
          'poster',
          posterCols,
          keys.map((key) => ({ key, display_name: insertPosterName.get(key) ?? 'unknown' })),
          { onConflict: 'ON CONFLICT (key) DO NOTHING' }
        )
        const after = await c.query('SELECT id, key FROM poster WHERE key = ANY($1)', [keys])
        for (const raw of after.rows as unknown[]) {
          const r = PosterKeyRow.parse(raw)
          posterIdByKey.set(r.key, r.id)
        }
      })
    }

    // 3. Insert messages.
    const insertRowsData: Record<string, unknown>[] = []
    const archiveIdsTouched = new Set<number>()
    const insertedExternalIds: string[] = []
    for (const plan of plans) {
      if (plan.threadId === null) continue
      for (const mm of plan.members) {
        if (mm.fate !== 'insert') continue
        const archiveId = archiveIdBySource.get(mm.record.source_id)
        if (archiveId === undefined) continue
        const pKey = mm.record.poster_key ?? posterKey(null, mm.record.author_name ?? 'unknown')
        const posterId = posterIdByKey.get(pKey)
        if (posterId === undefined) continue
        const { dateOnly, datePrecision } = mapDates(mm.record.date_precision, mm.inheritedDate)
        const body = bodyOf(mm.record.id)
        insertRowsData.push({
          archive_id: archiveId,
          thread_id: plan.threadId,
          poster_id: posterId,
          parent_ref: mm.parentRef,
          depth: mm.depth,
          message_id: mm.externalId,
          subject: mm.record.title,
          posted_at: mm.sortAt,
          body,
          line_count: countLines(body),
          is_spam: false,
          date_only: dateOnly,
          date_precision: datePrecision,
          source_record_id: mm.record.id,
        })
        archiveIdsTouched.add(archiveId)
        insertedExternalIds.push(mm.externalId)
        touchedThreadIds.add(plan.threadId)
      }
    }
    if (insertRowsData.length > 0) {
      await inTransaction(async (c) => {
        await insertRows(c, 'message', messageCols, insertRowsData, {
          onConflict: 'ON CONFLICT (archive_id, message_id) DO NOTHING',
        })
      })
    }

    // 4. Map inserted message ids by (archive, message_id).
    const messageIdByKey = new Map<string, number>() // `${archiveId}:${messageId}` → id
    if (insertedExternalIds.length > 0) {
      const archiveIds = [...archiveIdsTouched]
      await withClient(async (c) => {
        for (let i = 0; i < insertedExternalIds.length; i += 2000) {
          const chunk = insertedExternalIds.slice(i, i + 2000)
          const res = await c.query(
            'SELECT id, message_id, archive_id FROM message WHERE archive_id = ANY($1) AND message_id = ANY($2)',
            [archiveIds, chunk]
          )
          for (const raw of res.rows as unknown[]) {
            const r = MessageIdRow.parse(raw)
            messageIdByKey.set(`${r.archive_id}:${r.message_id}`, r.id)
          }
        }
      })
    }

    // 5. Memberships + record_show import status.
    const membershipRows: Record<string, unknown>[] = []
    const rsRecordIds: number[] = []
    const rsStatus: string[] = []
    const rsMessageId: number[] = []
    const addMembership = (messageId: number, recordId: number, role: string): void => {
      membershipRows.push({ message_id: messageId, record_id: recordId, role })
    }
    for (const plan of plans) {
      if (plan.threadId === null) continue
      for (const mm of plan.members) {
        let messageId: number | null
        let status: string
        if (mm.fate === 'insert') {
          const archiveId = archiveIdBySource.get(mm.record.source_id)
          messageId = archiveId === undefined ? null : (messageIdByKey.get(`${archiveId}:${mm.externalId}`) ?? null)
          status = 'imported'
        } else if (mm.fate === 'alreadyImported') {
          messageId = mm.legacyId
          status = 'imported'
        } else {
          messageId = mm.legacyId
          status = 'linked'
        }
        if (messageId === null) continue
        if (mm.fate === 'linked') {
          addMembership(messageId, mm.record.id, 'additional')
        } else {
          addMembership(messageId, mm.record.id, 'primary')
        }
        for (const addId of mm.additionalRecordIds) addMembership(messageId, addId, 'additional')
        for (const rid of [mm.record.id, ...mm.additionalRecordIds]) {
          rsRecordIds.push(rid)
          rsStatus.push(status)
          rsMessageId.push(messageId)
        }
      }
    }
    if (membershipRows.length > 0 || rsRecordIds.length > 0) {
      await inTransaction(async (c) => {
        await insertRows(c, 'message_source', messageSourceCols, membershipRows, {
          onConflict: 'ON CONFLICT (message_id, record_id) DO NOTHING',
        })
        for (let i = 0; i < rsRecordIds.length; i += 2000) {
          await c.query(
            `UPDATE record_show rs SET import_status = u.st::"ImportStatus", message_id = u.mid, updated_at = now()
             FROM unnest($1::int[], $2::text[], $3::int[]) AS u(rid, st, mid)
             WHERE rs.record_id = u.rid AND rs.show_id = $4`,
            [rsRecordIds.slice(i, i + 2000), rsStatus.slice(i, i + 2000), rsMessageId.slice(i, i + 2000), ctx.showId]
          )
        }
      })
    }

    // 6-7. Parent resolution, root/slug for import threads, recount touched.
    if (touchedThreadIds.size > 0) {
      const touched = [...touchedThreadIds]
      const importIds = [...importThreadIds].filter((id) => touchedThreadIds.has(id))
      await inTransaction(async (c) => {
        await c.query('ANALYZE message')
        await c.query(
          `UPDATE message m SET parent_id = p.id
           FROM message p
           WHERE m.thread_id = ANY($1) AND m.parent_id IS NULL AND m.parent_ref IS NOT NULL
             AND p.thread_id = m.thread_id AND p.message_id = m.parent_ref`,
          [touched]
        )
        if (importIds.length > 0) {
          await c.query(
            `UPDATE thread t SET root_message_id = m.id
             FROM message m
             WHERE t.id = ANY($1) AND m.thread_id = t.id
               AND m.id = (SELECT m2.id FROM message m2 WHERE m2.thread_id = t.id AND m2.depth = 0 ORDER BY m2.posted_at, m2.id LIMIT 1)`,
            [importIds]
          )
        }
        // slug rewrite — provisional import slugs only; legacy slugs untouched.
        await c.query(
          `UPDATE thread t
           SET slug = coalesce(left(encode(sha256(convert_to(s.slug || ':' || (
                 SELECT m.message_id FROM message m
                 WHERE m.thread_id = t.id ORDER BY m.posted_at, m.id LIMIT 1
               ), 'UTF8')), 'hex'), 12), t.slug)
           FROM show s
           WHERE s.id = t.show_id AND t.show_id = $1 AND t.import_key IS NOT NULL AND t.slug LIKE '~%'`,
          [ctx.showId]
        )
        await c.query(
          `UPDATE thread t SET
             message_count = c.mc, poster_count = c.pc, max_depth = c.md,
             last_post_at = c.last, started_at = c.first, started_date_only = c.first_date_only
           FROM (
             SELECT thread_id,
               count(*)::int mc,
               count(distinct poster_id)::int pc,
               max(depth)::int md,
               max(posted_at) last,
               min(posted_at) first,
               (array_agg(date_only ORDER BY posted_at, id))[1] first_date_only
             FROM message WHERE thread_id = ANY($1) GROUP BY thread_id
           ) c
           WHERE t.id = c.thread_id`,
          [touched]
        )
      })
    }
  }

  // ── attribution: thread_episode + classification merge + episode links ──────
  const classified = await loadKeyed(join(ctx.workDir, 'classified.jsonl'), ClassifiedRecord)
  const enriched = await loadKeyed(join(ctx.workDir, 'enriched.jsonl'), EnrichedRecord)

  const keyToEpisodeId = await withClient(async (c) => {
    const res = await c.query('SELECT id, slug FROM episode WHERE show_id = $1', [ctx.showId])
    const bySlug = new Map<string, number>()
    for (const raw of res.rows as unknown[]) {
      const r = z.object({ id: z.number().int(), slug: z.string() }).parse(raw)
      bySlug.set(r.slug, r.id)
    }
    const byKey = new Map<string, number>()
    for (const [key, ep] of ctx.index.byKey) {
      const id = bySlug.get(ep.slug)
      if (id !== undefined) byKey.set(key, id)
    }
    return byKey
  })

  type TeRow = { episodeKey: string; episodeId: number; confidence: number; method: 'llm' | 'heuristic'; isPrimary: boolean; relation: 'live' | 'retro' }
  const attributionByPlan = new Map<PlannedConversation, { rows: TeRow[]; primaryEpisodeId: number | null }>()

  for (const plan of importPlans) {
    const startedMs = Date.parse(plan.earliestAt)
    const rows: TeRow[] = []
    const seen = new Set<number>()
    const add = (key: string, confidence: number, method: 'llm' | 'heuristic', isPrimary: boolean): void => {
      const episodeId = keyToEpisodeId.get(key)
      if (episodeId === undefined || seen.has(episodeId)) return
      const ep = ctx.index.byKey.get(key)
      if (ep === undefined) return
      seen.add(episodeId)
      rows.push({ episodeKey: key, episodeId, confidence, method, isPrimary, relation: threadRelation(airDateMs(ep), startedMs, ctx.liveWindowDays) })
    }
    const cl = classified.get(plan.key)?.classification
    if (cl) {
      if (cl.episode && cl.episodeConfidence >= 40) add(cl.episode, cl.episodeConfidence, 'llm', true)
      for (const key of cl.secondaryEpisodes) add(key, Math.min(cl.episodeConfidence, 50), 'llm', false)
    } else {
      const cands = candidatesByKey.get(plan.key)?.candidates ?? []
      const top = cands[0]
      if (top && top.score >= 4) {
        add(top.key, Math.min(90, Math.round(top.score * 12)), 'heuristic', true)
      } else {
        // No classifier and no title match: a show conversation that started
        // within ~1.7 days of exactly one air date is attributed to that episode
        // at low confidence (the legacy pipeline leaves this to the LLM, which
        // has no credits). One window candidate only — two candidates is a guess.
        const windowed = cands.filter((c) => c.signals.some((sig) => sig.startsWith('window:')))
        const only = windowed[0]
        if (windowed.length === 1 && only !== undefined && only.score >= 2.5) add(only.key, 45, 'heuristic', true)
      }
    }
    const primary = rows.find((r) => r.isPrimary)
    attributionByPlan.set(plan, { rows, primaryEpisodeId: primary?.episodeId ?? null })

    for (const r of rows) {
      if (r.method === 'llm') summary.threadEpisodes.llm++
      else summary.threadEpisodes.heuristic++
      if (r.relation === 'live') summary.threadEpisodes.live++
      else summary.threadEpisodes.retro++
    }
    if (rows.length === 0) summary.threadEpisodes.unattributed++
  }

  if (!ctx.dryRun) {
    const attributedImportIds = importPlans.map((p) => p.threadId).filter((id): id is number => id !== null)
    await inTransaction(async (c) => {
      if (attributedImportIds.length > 0) {
        await c.query(`DELETE FROM thread_episode WHERE thread_id = ANY($1) AND method IN ('heuristic','llm')`, [attributedImportIds])
      }
      const teRows: Record<string, unknown>[] = []
      const rsRecordIds: number[] = []
      const rsEpisodeIds: number[] = []
      for (const plan of importPlans) {
        if (plan.threadId === null) continue
        const attr = attributionByPlan.get(plan)
        if (attr === undefined) continue
        for (const r of attr.rows) {
          teRows.push({
            thread_id: plan.threadId,
            episode_id: r.episodeId,
            relation: r.relation,
            confidence: r.confidence,
            method: r.method,
            is_primary: r.isPrimary,
          })
        }
        if (attr.primaryEpisodeId !== null) {
          for (const mm of plan.members) {
            for (const rid of [mm.record.id, ...mm.additionalRecordIds]) {
              rsRecordIds.push(rid)
              rsEpisodeIds.push(attr.primaryEpisodeId)
            }
          }
        }
      }
      if (teRows.length > 0) {
        await insertRows(c, 'thread_episode', teCols, teRows, { onConflict: 'ON CONFLICT (thread_id, episode_id) DO NOTHING' })
      }
      for (let i = 0; i < rsRecordIds.length; i += 2000) {
        await c.query(
          `UPDATE record_show rs SET episode_id = u.eid, updated_at = now()
           FROM unnest($1::int[], $2::int[]) AS u(rid, eid)
           WHERE rs.record_id = u.rid AND rs.show_id = $3`,
          [rsRecordIds.slice(i, i + 2000), rsEpisodeIds.slice(i, i + 2000), ctx.showId]
        )
      }
    })

    // Classification columns merged from classified/enriched (import threads).
    const clUpdates = importPlans
      .filter((p) => p.threadId !== null && classified.has(p.key))
      .map((p) => {
        const rec = classified.get(p.key)
        const cl = rec?.classification
        const en = enriched.get(p.key)
        return {
          tid: p.threadId,
          kind: cl?.kind ?? null,
          sentiment: cl?.sentiment ?? null,
          hot_take: cl?.hotTake ?? null,
          summary: en?.summary ?? cl?.summary ?? null,
          pull_quote: cl?.pullQuote ?? null,
          prediction_claim: en?.predictionClaim ?? cl?.predictionClaim ?? null,
          prediction_outcome: en?.predictionOutcome ?? cl?.predictionOutcome ?? null,
          model: rec?.model ?? null,
          is_spam: (cl?.spamProbability ?? 0) >= 90,
        }
      })
    if (clUpdates.length > 0) {
      await inTransaction(async (c) => {
        await c.query(
          `UPDATE thread t SET
             kind = u.kind::"ThreadKind",
             sentiment = u.sentiment::"Sentiment",
             hot_take = u.hot_take,
             summary = u.summary,
             pull_quote = u.pull_quote,
             prediction_claim = u.prediction_claim,
             prediction_outcome = u.prediction_outcome::"PredictionOutcome",
             classified_at = now(),
             classify_model = u.model,
             is_spam = u.is_spam
           FROM unnest($1::int[], $2::text[], $3::text[], $4::bool[], $5::text[], $6::text[], $7::text[], $8::text[], $9::text[], $10::bool[])
             AS u(tid, kind, sentiment, hot_take, summary, pull_quote, prediction_claim, prediction_outcome, model, is_spam)
           WHERE t.id = u.tid`,
          [
            clUpdates.map((u) => u.tid),
            clUpdates.map((u) => u.kind),
            clUpdates.map((u) => u.sentiment),
            clUpdates.map((u) => u.hot_take),
            clUpdates.map((u) => u.summary),
            clUpdates.map((u) => u.pull_quote),
            clUpdates.map((u) => u.prediction_claim),
            clUpdates.map((u) => u.prediction_outcome),
            clUpdates.map((u) => u.model),
            clUpdates.map((u) => u.is_spam),
          ]
        )
      })
    }
  }

  if (!ctx.dryRun) {
    const showFingerprint: InputFingerprint = { ...globalFingerprint }
    writeJson(showFingerprintPath, showFingerprint)
  }

  summary.durationMs = Date.now() - started
  ctx.log(
    `usenet import ${ctx.dryRun ? '(dry run) ' : ''}— conversations ${summary.conversations.inScope} ` +
      `(${summary.conversations.newThreads} new, ${summary.conversations.joinedLegacy} joined legacy), ` +
      `messages ${summary.messages.inserted} inserted / ${summary.messages.linked} linked / ${summary.messages.alreadyImported} already, ` +
      `thread_episode ${summary.threadEpisodes.llm} llm + ${summary.threadEpisodes.heuristic} heuristic`
  )
  return summary
}

// The conversation-relative parent Message-ID for a checkpoint threaded row.
function externalIdByCanonicalFor(plan: PlannedConversation, canonicalId: string): string | null {
  for (const mm of plan.members) if (mm.canonicalId === canonicalId) return mm.externalId
  return null
}

// Attribute-stage text view of an import thread (root + earliest replies), using
// the same limits as pipeline/stages/attribute.ts.
function buildThreadText(plan: PlannedConversation, bodyOf: (id: number) => string): ThreadText {
  const clean = (b: string, lim: number): string => withoutQuotedLines(b).toLowerCase().slice(0, lim)
  let rootBody = ''
  let rootSortAt: string | null = null
  const replies: { postedAt: string; body: string }[] = []
  const replySubjects = new Set<string>()
  for (const mm of plan.members) {
    const body = bodyOf(mm.record.id)
    if (mm.depth === 0) {
      if (rootSortAt === null || mm.sortAt < rootSortAt) {
        rootSortAt = mm.sortAt
        rootBody = clean(body, ROOT_LIMIT)
      }
    } else {
      replySubjects.add(normalizeSubject(mm.record.title).norm)
      replies.push({ postedAt: mm.sortAt, body: clean(body, REPLY_LIMIT) })
      replies.sort((a, b) => (a.postedAt < b.postedAt ? -1 : a.postedAt > b.postedAt ? 1 : 0))
      if (replies.length > MAX_REPLIES) replies.length = MAX_REPLIES
    }
  }
  return { subject: normalizeSubject(plan.members[0]?.record.title ?? '').norm, rootBody, replySubjects: [...replySubjects], replyBodies: replies.map((r) => r.body) }
}

async function loadKeyed<T extends { threadKey: string }>(path: string, schema: z.ZodType<T>): Promise<Map<string, T>> {
  const map = new Map<string, T>()
  if (!checkpointExists(path)) return map
  for await (const rec of readJsonl(path, schema)) map.set(rec.threadKey, rec)
  return map
}
