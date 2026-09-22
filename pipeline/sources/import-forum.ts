// Project accepted forum posts into the serving tables for one show. A native
// topic is a thread (import_key = its conversation key); posts keep their native
// order and time, no reply edges are synthesized (decisions.md 2026-09-21). Post
// bodies are stored verbatim in the catalog with `[quote]` markers; they are
// converted to Usenet quote grammar here so the reader treats them like a Usenet
// reply. Idempotent per (show, forum source): a re-run inserts nothing new — a
// post already projected is counted `alreadyImported` and only re-linked.
import { basename } from 'node:path'
import { z } from 'zod'
import { insertRows, inTransaction, withClient, type ColumnSpec } from '../lib/db'
import { countLines } from '../lib/normalize'
import { daysAfterAir, isLive, postTiming } from '../lib/timing'
import { forumBodyToUsenet } from './forum-quotes'
import { DatePrecision } from './types'
import type { ImportContext, SourceInfo } from './import'

// ───────────────────────── pure decisions (unit-tested) ─────────────────────────

// Deleted/guest forum accounts carry no stable identity, so every guest post is
// attributed to one shared poster per source (mirrors catalog-forum's key shape,
// with the fixed suffix "guest" instead of an account id).
export function guestPosterKey(sourceKey: string): string {
  return new Bun.CryptoHasher('sha256').update(`forum:${sourceKey}:guest`).digest('hex').slice(0, 16)
}

export function resolvePoster(
  posterKey: string | null,
  authorName: string | null,
  sourceKey: string
): { key: string; displayName: string; guest: boolean } {
  if (posterKey === null) {
    return { key: guestPosterKey(sourceKey), displayName: authorName ?? 'deleted user', guest: true }
  }
  return { key: posterKey, displayName: authorName ?? 'deleted user', guest: false }
}

// The topic contains live reaction when at least one of its posts falls inside
// the show's live window. `days` is null for an undated post (never live).
export function topicRelation(days: readonly (number | null)[], liveWindowDays: number): 'live' | 'retro' {
  return days.some((d) => d !== null && isLive(d, liveWindowDays)) ? 'live' : 'retro'
}

// Per-post timing counts against the topic's episode (read-time labels; undated
// posts are neither before/live/later here).
export function postTimingCounts(
  days: readonly (number | null)[],
  liveWindowDays: number
): { livePosts: number; beforePosts: number; laterPosts: number } {
  let livePosts = 0
  let beforePosts = 0
  let laterPosts = 0
  for (const d of days) {
    if (d === null) continue
    const t = postTiming(d, liveWindowDays)
    if (t === 'live') livePosts++
    else if (t === 'before') beforePosts++
    else if (t === 'later') laterPosts++
  }
  return { livePosts, beforePosts, laterPosts }
}

// A post already in the projection (its canonical id is a message id under this
// archive) is left untouched and counted alreadyImported; the rest are inserted.
export function partitionByExisting<T extends { canonicalId: string }>(
  records: readonly T[],
  existing: ReadonlySet<string>
): { toInsert: T[]; alreadyImported: number } {
  const toInsert: T[] = []
  let alreadyImported = 0
  for (const r of records) {
    if (existing.has(r.canonicalId)) alreadyImported++
    else toInsert.push(r)
  }
  return { toInsert, alreadyImported }
}

// All posts in a topic share one episode; if a stray disposition disagrees, the
// majority wins and the caller logs it.
export function majorityEpisodeId(ids: readonly (number | null)[]): {
  episodeId: number | null
  disagreement: boolean
} {
  const counts = new Map<number, number>()
  for (const id of ids) if (id !== null) counts.set(id, (counts.get(id) ?? 0) + 1)
  if (counts.size === 0) return { episodeId: null, disagreement: false }
  let best: number | null = null
  let bestN = -1
  for (const [id, n] of counts) {
    if (n > bestN) {
      bestN = n
      best = id
    }
  }
  return { episodeId: best, disagreement: counts.size > 1 }
}

// ───────────────────────── projection ─────────────────────────

// posted_at is a TIMESTAMP storing UTC wall clock; to_char with a literal Z gives
// the same ISO the Usenet loader stores (the Z is ignored on re-insert into a
// timestamp column), and AT TIME ZONE 'UTC' before extract(epoch) reads it back
// as the same instant for timing. Reading the raw column would let node-pg apply
// the machine zone and shift both.
const ForumProjRecord = z.object({
  id: z.number().int(),
  record_id: z.string(),
  external_id: z.string(),
  canonical_id: z.string(),
  thread_external_id: z.string().nullable(),
  title: z.string(),
  author_name: z.string().nullable(),
  poster_key: z.string().nullable(),
  posted_at_iso: z.string().nullable(),
  posted_at_ms: z.coerce.number().nullable(),
  date_precision: DatePrecision,
  body: z.string(),
  episode_id: z.number().int().nullable(),
  conversation_key: z.string().nullable(),
})
type ProjRecord = z.infer<typeof ForumProjRecord>

const IdRow = z.object({ id: z.number().int() })
const IdSlugRow = z.object({ id: z.number().int(), slug: z.string() })
const KeyRow = z.object({ key: z.string() })
const KeyIdRow = z.object({ id: z.number().int(), key: z.string() })
const MsgIdRow = z.object({ id: z.number().int(), message_id: z.string() })
const AirRow = z.object({ air_date: z.string() })

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

const messageSourceCols: ColumnSpec[] = [
  { name: 'message_id', type: 'int' },
  { name: 'record_id', type: 'int' },
  { name: 'role', type: 'text' },
]

export type ForumTopicSummary = {
  threadId: number | null
  slug: string | null
  episodeId: number | null
  relation: 'live' | 'retro'
  posts: number
  inserted: number
  alreadyImported: number
  livePosts: number
  beforePosts: number
  laterPosts: number
}

export type ForumImportSummary = {
  archiveId: number | null
  topics: Record<string, ForumTopicSummary>
  messages: { inserted: number; alreadyImported: number }
  posters: { new: number; guest: number }
  durationMs: number
}

async function loadRecords(showId: number, sourceId: number): Promise<ProjRecord[]> {
  return withClient(async (c) => {
    const res = await c.query(
      `SELECT r.id, r.record_id, r.external_id, r.canonical_id, r.thread_external_id, r.title,
              r.author_name, r.poster_key,
              to_char(r.posted_at, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS posted_at_iso,
              (extract(epoch FROM r.posted_at AT TIME ZONE 'UTC') * 1000) AS posted_at_ms,
              r.date_precision, r.body, rs.episode_id, rs.conversation_key
       FROM record_show rs
       JOIN source_record r ON r.id = rs.record_id
       WHERE rs.show_id = $1 AND rs.status = 'accepted' AND r.source_id = $2 AND r.kind = 'post'
       ORDER BY r.thread_external_id, r.posted_at, r.external_id`,
      [showId, sourceId]
    )
    return (res.rows as unknown[]).map((row) => ForumProjRecord.parse(row))
  })
}

// Canonical ids (message_id) already projected under an archive — a post already
// present is left in place and only re-linked.
async function loadExistingProjection(archiveId: number): Promise<Set<string>> {
  return withClient(async (c) => {
    const res = await c.query('SELECT message_id FROM message WHERE archive_id = $1', [archiveId])
    const out = new Set<string>()
    for (const row of res.rows as unknown[]) out.add(z.object({ message_id: z.string() }).parse(row).message_id)
    return out
  })
}

export async function importForum(ctx: ImportContext): Promise<ForumImportSummary> {
  const started = Date.now()
  const forumSources = ctx.sources.filter((s) => s.kind === 'forum')
  const source = forumSources[0]
  if (source === undefined) {
    return { archiveId: null, topics: {}, messages: { inserted: 0, alreadyImported: 0 }, posters: { new: 0, guest: 0 }, durationMs: Date.now() - started }
  }
  if (forumSources.length > 1) {
    ctx.log(`forum: ${forumSources.length} forum sources; importing only "${source.key}" (one archive per run)`)
  }

  const records = await loadRecords(ctx.showId, source.id)
  ctx.log(`forum: ${records.length} accepted posts from ${source.key}${ctx.dryRun ? ' (dry run)' : ''}`)

  // Archive: one row per (show, community). Upserted for a real run; only looked
  // up for a dry run so an existing projection can still be reconciled.
  const archiveId = ctx.dryRun ? await lookupArchive(ctx.showId, source.community_key) : await upsertArchive(ctx.showId, source)
  const existing = archiveId === null ? new Set<string>() : await loadExistingProjection(archiveId)

  // Posters: resolve every post's key (guests collapse to one shared key), then
  // upsert the missing ones. `new` is the keys this run creates; `guest` is the
  // number of guest/deleted posts.
  const posterOf = new Map<string, { key: string; displayName: string }>()
  let guestPosts = 0
  for (const r of records) {
    const p = resolvePoster(r.poster_key, r.author_name, source.key)
    if (p.guest) guestPosts++
    if (!posterOf.has(p.key)) posterOf.set(p.key, { key: p.key, displayName: p.displayName })
  }
  const posterKeys = [...posterOf.keys()]
  const existingKeys = await loadExistingPosterKeys(posterKeys)
  const newPosterKeys = posterKeys.filter((k) => !existingKeys.has(k))
  const posterIdByKey = new Map<string, number>()
  if (!ctx.dryRun && posterOf.size > 0) {
    await inTransaction(async (c) => {
      await insertRows(
        c,
        'poster',
        [
          { name: 'key', type: 'text' },
          { name: 'display_name', type: 'text' },
        ],
        [...posterOf.values()].map((p) => ({ key: p.key, display_name: p.displayName })),
        { onConflict: 'ON CONFLICT (key) DO NOTHING' }
      )
      for (let i = 0; i < posterKeys.length; i += 5000) {
        const chunk = posterKeys.slice(i, i + 5000)
        const res = await c.query('SELECT id, key FROM poster WHERE key = ANY($1)', [chunk])
        for (const row of res.rows as unknown[]) {
          const k = KeyIdRow.parse(row)
          posterIdByKey.set(k.key, k.id)
        }
      }
    })
  }

  // Group posts by native topic, in load order.
  const byTopic = new Map<string, ProjRecord[]>()
  for (const r of records) {
    if (r.thread_external_id === null) {
      ctx.log(`forum: skipping post ${r.external_id} — no topic (thread_external_id null)`)
      continue
    }
    const bucket = byTopic.get(r.thread_external_id)
    if (bucket) bucket.push(r)
    else byTopic.set(r.thread_external_id, [r])
  }

  const airMsCache = new Map<number, number | null>()
  const airMsFor = async (episodeId: number): Promise<number | null> => {
    const cached = airMsCache.get(episodeId)
    if (cached !== undefined) return cached
    const ms = await withClient(async (c) => {
      const res = await c.query(`SELECT to_char(air_date, 'YYYY-MM-DD') AS air_date FROM episode WHERE id = $1`, [episodeId])
      const row = res.rows[0]
      if (row === undefined) return null
      return Date.parse(`${AirRow.parse(row).air_date}T00:00:00Z`)
    })
    airMsCache.set(episodeId, ms)
    return ms
  }

  const topics: Record<string, ForumTopicSummary> = {}
  const touchedThreadIds: number[] = []
  let messagesInserted = 0
  let messagesAlready = 0

  for (const [topic, topicRecords] of byTopic) {
    const importKey = topicRecords.find((r) => r.conversation_key !== null)?.conversation_key ?? `forum:${source.key}:${topic}`
    const { episodeId, disagreement } = majorityEpisodeId(topicRecords.map((r) => r.episode_id))
    if (disagreement) ctx.log(`forum: topic ${topic} has posts across multiple episodes; using majority ${episodeId ?? 'none'}`)

    const airMs = episodeId === null ? null : await airMsFor(episodeId)
    const days = topicRecords.map((r) => (airMs === null || r.posted_at_ms === null ? null : daysAfterAir(airMs, r.posted_at_ms)))
    const relation = topicRelation(days, ctx.liveWindowDays)
    const counts = postTimingCounts(days, ctx.liveWindowDays)

    const isos = topicRecords.map((r) => r.posted_at_iso).filter((v): v is string => v !== null)
    const startedAt = isos.reduce((a, b) => (a < b ? a : b), isos[0] ?? new Date().toISOString())
    const lastPostAt = isos.reduce((a, b) => (a > b ? a : b), isos[0] ?? new Date().toISOString())
    const posterCount = new Set(topicRecords.map((r) => resolvePoster(r.poster_key, r.author_name, source.key).key)).size
    const { toInsert, alreadyImported } = partitionByExisting(
      topicRecords.map((r) => ({ canonicalId: r.canonical_id, rec: r })),
      existing
    )
    messagesAlready += alreadyImported
    // Count intended inserts once (they equal the rows inserted below in a real
    // run, since toInsert holds only posts not already projected); a dry run
    // reports the same figure without writing.
    messagesInserted += toInsert.length

    let threadId: number | null = null
    let slug: string | null = null

    if (!ctx.dryRun && archiveId !== null) {
      await inTransaction(async (c) => {
        const threadRes = await c.query(
          `INSERT INTO thread (show_id, archive_id, import_key, slug, subject, started_at, started_date_only,
                               last_post_at, message_count, poster_count, max_depth, is_spam)
           VALUES ($1,$2,$3,$4,$5,$6,false,$7,$8,$9,0,false)
           ON CONFLICT (show_id, import_key) DO UPDATE SET
             last_post_at = EXCLUDED.last_post_at, message_count = EXCLUDED.message_count, poster_count = EXCLUDED.poster_count
           RETURNING id, slug`,
          [
            ctx.showId,
            archiveId,
            importKey,
            `~${importKey}`,
            topicRecords[0]?.title ?? '(no subject)',
            startedAt,
            lastPostAt,
            topicRecords.length,
            posterCount,
          ]
        )
        const tr = IdSlugRow.parse(threadRes.rows[0])
        threadId = tr.id
        slug = tr.slug
        touchedThreadIds.push(tr.id)

        // Messages for posts not already projected.
        if (toInsert.length > 0) {
          const rows = toInsert.map(({ rec }) => {
            const poster = resolvePoster(rec.poster_key, rec.author_name, source.key)
            const posterId = posterIdByKey.get(poster.key)
            if (posterId === undefined) throw new Error(`no poster id for key ${poster.key} (post ${rec.external_id})`)
            const body = forumBodyToUsenet(rec.body)
            return {
              archive_id: archiveId,
              thread_id: tr.id,
              poster_id: posterId,
              parent_ref: null,
              depth: 0,
              message_id: rec.canonical_id,
              subject: rec.title,
              posted_at: rec.posted_at_iso,
              body,
              line_count: countLines(body),
              is_spam: false,
              date_only: false,
              date_precision: 'minute',
              source_record_id: rec.id,
            }
          })
          await insertRows(c, 'message', messageCols, rows, { onConflict: 'ON CONFLICT (archive_id, message_id) DO NOTHING' })
        }

        // Map every post in the topic (new and pre-existing) to its message id,
        // then attach the source membership and mark the disposition imported.
        const canonicalIds = topicRecords.map((r) => r.canonical_id)
        const idRes = await c.query('SELECT id, message_id FROM message WHERE archive_id = $1 AND message_id = ANY($2)', [
          archiveId,
          canonicalIds,
        ])
        const msgIdByCanonical = new Map<string, number>()
        for (const row of idRes.rows as unknown[]) {
          const m = MsgIdRow.parse(row)
          msgIdByCanonical.set(m.message_id, m.id)
        }
        const membershipRows: Record<string, unknown>[] = []
        const rids: number[] = []
        const mids: number[] = []
        for (const rec of topicRecords) {
          const mid = msgIdByCanonical.get(rec.canonical_id)
          if (mid === undefined) continue
          membershipRows.push({ message_id: mid, record_id: rec.id, role: 'primary' })
          rids.push(rec.id)
          mids.push(mid)
        }
        if (membershipRows.length > 0) {
          await insertRows(c, 'message_source', messageSourceCols, membershipRows, { onConflict: 'ON CONFLICT DO NOTHING' })
          await c.query(
            `UPDATE record_show rs SET import_status = 'imported', message_id = u.mid
             FROM unnest($1::int[], $2::int[]) AS u(rid, mid)
             WHERE rs.record_id = u.rid AND rs.show_id = $3`,
            [rids, mids, ctx.showId]
          )
        }

        // thread_episode: the topic's official episode, relation from post timing.
        if (episodeId !== null) {
          await c.query(`DELETE FROM thread_episode WHERE thread_id = $1 AND method = 'official-topic'`, [tr.id])
          await c.query(
            `INSERT INTO thread_episode (thread_id, episode_id, relation, confidence, method, is_primary)
             VALUES ($1,$2,$3::"EpisodeRelation",95,'official-topic',true)
             ON CONFLICT (thread_id, episode_id) DO NOTHING`,
            [tr.id, episodeId, relation]
          )
        }
      })
    }

    topics[topic] = {
      threadId,
      slug,
      episodeId,
      relation,
      posts: topicRecords.length,
      inserted: toInsert.length,
      alreadyImported,
      livePosts: counts.livePosts,
      beforePosts: counts.beforePosts,
      laterPosts: counts.laterPosts,
    }
  }

  // Post-projection fixups over the threads this run touched.
  if (!ctx.dryRun && touchedThreadIds.length > 0) {
    await inTransaction(async (c) => {
      await c.query('ANALYZE message')
      await c.query(
        `UPDATE thread t SET root_message_id = (
           SELECT m.id FROM message m WHERE m.thread_id = t.id ORDER BY m.posted_at, m.id LIMIT 1
         ) WHERE t.id = ANY($1)`,
        [touchedThreadIds]
      )
      // Same slug expression as the Usenet loader; keep the two identical.
      await c.query(
        `UPDATE thread t
         SET slug = coalesce(left(encode(sha256(convert_to(s.slug || ':' || (
               SELECT m.message_id FROM message m
               WHERE m.thread_id = t.id ORDER BY m.posted_at, m.id LIMIT 1
             ), 'UTF8')), 'hex'), 12), t.slug)
         FROM show s
         WHERE s.id = t.show_id AND t.show_id = $1 AND t.import_key LIKE 'forum:%' AND t.slug LIKE '~%'`,
        [ctx.showId]
      )
      // Return the settled slugs so the summary reports the stable URL, not '~…'.
      const res = await c.query('SELECT id, slug FROM thread WHERE id = ANY($1)', [touchedThreadIds])
      const slugById = new Map<number, string>()
      for (const row of res.rows as unknown[]) {
        const r = IdSlugRow.parse(row)
        slugById.set(r.id, r.slug)
      }
      for (const t of Object.values(topics)) {
        if (t.threadId !== null) {
          const s = slugById.get(t.threadId)
          if (s !== undefined) t.slug = s
        }
      }
    })
  }

  ctx.log(
    `forum: ${Object.keys(topics).length} topics, ${messagesInserted} messages inserted, ${messagesAlready} already imported, ` +
      `${newPosterKeys.length} new posters, ${guestPosts} guest posts${ctx.dryRun ? ' (dry run)' : ''}`
  )

  return {
    archiveId,
    topics,
    messages: { inserted: messagesInserted, alreadyImported: messagesAlready },
    posters: { new: newPosterKeys.length, guest: guestPosts },
    durationMs: Date.now() - started,
  }
}

async function lookupArchive(showId: number, newsgroup: string): Promise<number | null> {
  return withClient(async (c) => {
    const res = await c.query('SELECT id FROM archive WHERE show_id = $1 AND newsgroup = $2', [showId, newsgroup])
    const row = res.rows[0]
    return row === undefined ? null : IdRow.parse(row).id
  })
}

async function upsertArchive(showId: number, source: SourceInfo): Promise<number> {
  const sourceFile = await withClient(async (c) => {
    const res = await c.query('SELECT path FROM artifact WHERE source_id = $1 ORDER BY id LIMIT 1', [source.id])
    const row = res.rows[0]
    if (row === undefined) return source.key
    return basename(z.object({ path: z.string() }).parse(row).path)
  })
  return inTransaction(async (c) => {
    const res = await c.query(
      `INSERT INTO archive (show_id, source_id, newsgroup, source_file)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (show_id, newsgroup) DO UPDATE SET source_id = EXCLUDED.source_id, ingested_at = now()
       RETURNING id`,
      [showId, source.id, source.community_key, sourceFile]
    )
    return IdRow.parse(res.rows[0]).id
  })
}

async function loadExistingPosterKeys(keys: string[]): Promise<Set<string>> {
  if (keys.length === 0) return new Set()
  return withClient(async (c) => {
    const out = new Set<string>()
    for (let i = 0; i < keys.length; i += 5000) {
      const res = await c.query('SELECT key FROM poster WHERE key = ANY($1)', [keys.slice(i, i + 5000)])
      for (const row of res.rows as unknown[]) out.add(KeyRow.parse(row).key)
    }
    return out
  })
}
