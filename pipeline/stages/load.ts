// Stage: load — write one archive's threads/messages/attribution into Postgres.
// Idempotent per archive: shows/seasons/episodes are upserted, then the archive's
// threads (and their cascaded messages + thread_episode rows) are deleted and
// rebuilt. Each numbered step runs in its own transaction. `message.search` is
// maintained by a DB trigger and is never written here.
import { readFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { z } from 'zod'
import {
  CandidateRecord,
  ClassifiedRecord,
  EnrichedRecord,
  EpisodesFile,
  ThreadRecord,
  ThreadedMessage,
  type Stage,
} from '../lib/types'
import { insertRows, inTransaction, type ColumnSpec } from '../lib/db'
import { checkpointExists, readJsonl, writeJson } from '../lib/checkpoint'
import { daysAfterAir, isLive } from '../lib/timing'

const DAY_MS = 86_400_000

const IdRow = z.object({ id: z.number().int() })
const SeasonRow = z.object({ id: z.number().int(), number: z.number().int() })
const EpisodeSlugRow = z.object({ id: z.number().int(), slug: z.string() })
const PosterKeyRow = z.object({ id: z.number().int(), key: z.string() })

const seasonCols: ColumnSpec[] = [
  { name: 'show_id', type: 'int' },
  { name: 'number', type: 'int' },
  { name: 'premiered', type: 'date' },
  { name: 'ended', type: 'date' },
  { name: 'episode_count', type: 'int' },
]

const episodeCols: ColumnSpec[] = [
  { name: 'show_id', type: 'int' },
  { name: 'season_id', type: 'int' },
  { name: 'season_number', type: 'int' },
  { name: 'number', type: 'int' },
  { name: 'slug', type: 'text' },
  { name: 'title', type: 'text' },
  { name: 'air_date', type: 'date' },
  { name: 'air_stamp', type: 'timestamp' },
  { name: 'runtime', type: 'int' },
  { name: 'summary', type: 'text' },
  { name: 'image_url', type: 'text' },
  { name: 'tvmaze_id', type: 'int' },
  { name: 'tvmaze_rating', type: 'float8' },
]

const posterCols: ColumnSpec[] = [
  { name: 'key', type: 'text' },
  { name: 'display_name', type: 'text' },
]

const threadCols: ColumnSpec[] = [
  { name: 'show_id', type: 'int' },
  { name: 'archive_id', type: 'int' },
  { name: 'subject', type: 'text' },
  { name: 'started_at', type: 'timestamp' },
  { name: 'last_post_at', type: 'timestamp' },
  { name: 'message_count', type: 'int' },
  { name: 'poster_count', type: 'int' },
  { name: 'max_depth', type: 'int' },
  { name: 'is_spam', type: 'boolean' },
  { name: 'started_date_only', type: 'boolean' },
  { name: 'slug', type: 'text' },
  { name: 'kind', type: 'ThreadKind' },
  { name: 'sentiment', type: 'Sentiment' },
  { name: 'hot_take', type: 'boolean' },
  { name: 'summary', type: 'text' },
  { name: 'pull_quote', type: 'text' },
  { name: 'prediction_claim', type: 'text' },
  { name: 'prediction_outcome', type: 'PredictionOutcome' },
  { name: 'classified_at', type: 'timestamp' },
  { name: 'classify_model', type: 'text' },
]

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
]

const teCols: ColumnSpec[] = [
  { name: 'thread_id', type: 'int' },
  { name: 'episode_id', type: 'int' },
  { name: 'relation', type: 'EpisodeRelation' },
  { name: 'confidence', type: 'int' },
  { name: 'method', type: 'text' },
  { name: 'is_primary', type: 'boolean' },
]

export const run: Stage['run'] = async (ctx) => {
  const work = ctx.paths.work
  const episodes = EpisodesFile.parse(JSON.parse(readFileSync(ctx.paths.episodesFile, 'utf8')))
  const threadedPath = join(work, 'threaded.jsonl')

  // threads + optional classification / candidates fit in memory (one per thread).
  const threadRows: ThreadRecord[] = []
  for await (const t of readJsonl(join(work, 'threads.jsonl'), ThreadRecord)) threadRows.push(t)

  const candidates = new Map<string, CandidateRecord>()
  const candPath = join(work, 'candidates.jsonl')
  if (checkpointExists(candPath))
    for await (const c of readJsonl(candPath, CandidateRecord)) candidates.set(c.threadKey, c)

  const classified = new Map<string, ClassifiedRecord>()
  const classPath = join(work, 'classified.jsonl')
  if (checkpointExists(classPath))
    for await (const r of readJsonl(classPath, ClassifiedRecord)) classified.set(r.threadKey, r)

  const enriched = new Map<string, EnrichedRecord>()
  const enrichedPath = join(work, 'enriched.jsonl')
  if (checkpointExists(enrichedPath))
    for await (const r of readJsonl(enrichedPath, EnrichedRecord)) enriched.set(r.threadKey, r)

  const timings: Record<string, number> = {}
  const timed = async <T>(label: string, fn: () => Promise<T>): Promise<T> => {
    const t0 = Date.now()
    const r = await fn()
    const ms = Date.now() - t0
    timings[label] = ms
    return r
  }

  // ── Step 1: show / seasons / episodes ──────────────────────────────────────
  const step1 = await timed('shows', () =>
    inTransaction(async (c) => {
      const showRes = await c.query(
        `INSERT INTO "show" (slug, name, tvmaze_id, premiered, ended, network, summary, image_url, live_window_days)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         ON CONFLICT (slug) DO UPDATE SET
           name=EXCLUDED.name, tvmaze_id=EXCLUDED.tvmaze_id, premiered=EXCLUDED.premiered,
           ended=EXCLUDED.ended, network=EXCLUDED.network, summary=EXCLUDED.summary,
           image_url=EXCLUDED.image_url, live_window_days=EXCLUDED.live_window_days
         RETURNING id`,
        [
          ctx.show.slug,
          ctx.show.name,
          ctx.show.tvmazeId ?? episodes.show.tvmazeId,
          episodes.show.premiered,
          episodes.show.ended,
          episodes.show.network,
          episodes.show.summary,
          episodes.show.imageUrl,
          ctx.show.liveWindowDays,
        ]
      )
      const showId = IdRow.parse(showRes.rows[0]).id

      const seasonAgg = new Map<number, { premiered: string; ended: string; count: number }>()
      for (const ep of episodes.episodes) {
        const s = seasonAgg.get(ep.season) ?? { premiered: ep.airDate, ended: ep.airDate, count: 0 }
        if (ep.airDate < s.premiered) s.premiered = ep.airDate
        if (ep.airDate > s.ended) s.ended = ep.airDate
        s.count++
        seasonAgg.set(ep.season, s)
      }
      const seasonReturned = await insertRows(
        c,
        'season',
        seasonCols,
        [...seasonAgg.entries()].map(([number, v]) => ({
          show_id: showId,
          number,
          premiered: v.premiered,
          ended: v.ended,
          episode_count: v.count,
        })),
        {
          returning: ['id', 'number'],
          returningSchema: SeasonRow,
          onConflict:
            'ON CONFLICT (show_id, number) DO UPDATE SET premiered=EXCLUDED.premiered, ended=EXCLUDED.ended, episode_count=EXCLUDED.episode_count',
        }
      )
      const seasonIdByNumber = new Map(seasonReturned.map((r) => [r.number, r.id]))

      const episodeInsert = episodes.episodes.map((ep) => {
        const seasonId = seasonIdByNumber.get(ep.season)
        if (seasonId === undefined) throw new Error(`no season row for S${ep.season}`)
        return {
          show_id: showId,
          season_id: seasonId,
          season_number: ep.season,
          number: ep.number,
          slug: ep.slug,
          title: ep.title,
          air_date: ep.airDate,
          air_stamp: ep.airStamp,
          runtime: ep.runtime,
          summary: ep.summary,
          image_url: ep.imageUrl,
          tvmaze_id: ep.tvmazeId,
          tvmaze_rating: ep.rating,
        }
      })
      const episodeReturned = await insertRows(c, 'episode', episodeCols, episodeInsert, {
        returning: ['id', 'slug'],
        returningSchema: EpisodeSlugRow,
        onConflict:
          'ON CONFLICT (show_id, slug) DO UPDATE SET season_id=EXCLUDED.season_id, season_number=EXCLUDED.season_number, number=EXCLUDED.number, title=EXCLUDED.title, air_date=EXCLUDED.air_date, air_stamp=EXCLUDED.air_stamp, runtime=EXCLUDED.runtime, summary=EXCLUDED.summary, image_url=EXCLUDED.image_url, tvmaze_id=EXCLUDED.tvmaze_id, tvmaze_rating=EXCLUDED.tvmaze_rating',
      })
      const idBySlug = new Map(episodeReturned.map((r) => [r.slug, r.id]))
      const episodeIdByKey = new Map<string, number>()
      const epAirMs = new Map<string, number>()
      for (const ep of episodes.episodes) {
        const id = idBySlug.get(ep.slug)
        if (id !== undefined) episodeIdByKey.set(ep.key, id)
        epAirMs.set(ep.key, Date.parse(ep.airDate + 'T00:00:00Z'))
      }
      return {
        showId,
        seasons: seasonReturned.length,
        episodesCount: episodeReturned.length,
        episodeIdByKey,
        epAirMs,
      }
    })
  )
  const { showId, episodeIdByKey, epAirMs } = step1
  ctx.log(
    `load shows: 1 show, ${step1.seasons} seasons, ${step1.episodesCount} episodes (${timings['shows']}ms)`
  )

  // ── Step 2: archive + purge prior threads ──────────────────────────────────
  const archiveId = await timed('archive', () =>
    inTransaction(async (c) => {
      const res = await c.query(
        `INSERT INTO "archive" (show_id, newsgroup, source_file)
         VALUES ($1,$2,$3)
         ON CONFLICT (show_id, newsgroup) DO UPDATE SET source_file=EXCLUDED.source_file, ingested_at=now()
         RETURNING id`,
        [showId, ctx.show.newsgroup, basename(ctx.paths.archive)]
      )
      const id = IdRow.parse(res.rows[0]).id
      await c.query('DELETE FROM thread WHERE archive_id = $1', [id])
      return id
    })
  )
  ctx.log(`load archive: id ${archiveId} (${timings['archive']}ms)`)

  // ── Step 3: posters (most frequent display name per key) ────────────────────
  const posterIdByKey = await timed('posters', async () => {
    const nameCounts = new Map<string, Map<string, number>>()
    for await (const m of readJsonl(threadedPath, ThreadedMessage)) {
      let names = nameCounts.get(m.posterKey)
      if (!names) {
        names = new Map()
        nameCounts.set(m.posterKey, names)
      }
      names.set(m.fromName, (names.get(m.fromName) ?? 0) + 1)
    }
    const posterInsert = [...nameCounts.entries()].map(([key, names]) => {
      let best = ''
      let bestN = -1
      for (const [name, cnt] of names) {
        if (cnt > bestN) {
          bestN = cnt
          best = name
        }
      }
      return { key, display_name: best }
    })
    const map = new Map<string, number>()
    await inTransaction(async (c) => {
      await insertRows(c, 'poster', posterCols, posterInsert, {
        onConflict: 'ON CONFLICT (key) DO NOTHING',
      })
      const keys = posterInsert.map((p) => p.key)
      for (let i = 0; i < keys.length; i += 5000) {
        const chunk = keys.slice(i, i + 5000)
        const res = await c.query('SELECT id, key FROM poster WHERE key = ANY($1)', [chunk])
        const rows: unknown[] = res.rows
        for (const row of rows) {
          const r = PosterKeyRow.parse(row)
          map.set(r.key, r.id)
        }
      }
    })
    return map
  })
  ctx.log(`load posters: ${posterIdByKey.size} distinct (${timings['posters']}ms)`)

  // ── Step 4: threads (merge classification) ──────────────────────────────────
  const now = new Date().toISOString()
  const threadIdByKey = await timed('threads', () =>
    inTransaction(async (c) => {
      const rows = threadRows.map((t) => {
        const rec = classified.get(t.threadKey)
        const cl = rec?.classification
        const en = enriched.get(t.threadKey)
        // Prose fields come from enrich, falling back to classify (null in both
        // until those stages run). Spam flips on a high classifier probability.
        return {
          show_id: showId,
          archive_id: archiveId,
          subject: t.subject,
          started_at: t.startedAt,
          last_post_at: t.lastPostAt,
          message_count: t.messageCount,
          poster_count: t.posterCount,
          max_depth: t.maxDepth,
          is_spam: t.isSpam || (cl?.spamProbability ?? 0) >= 90,
          started_date_only: t.startedDateOnly,
          // Provisional, unique per show; rewritten from the earliest message below.
          slug: `~${t.threadKey}`,
          kind: cl?.kind ?? null,
          sentiment: cl?.sentiment ?? null,
          hot_take: cl?.hotTake ?? null,
          summary: en?.summary ?? cl?.summary ?? null,
          pull_quote: cl?.pullQuote ?? null,
          prediction_claim: en?.predictionClaim ?? cl?.predictionClaim ?? null,
          prediction_outcome: en?.predictionOutcome ?? cl?.predictionOutcome ?? null,
          classified_at: cl ? now : null,
          classify_model: cl ? (rec?.model ?? null) : null,
        }
      })
      // RETURNING follows unnest array order, so ids line up with threadRows.
      const ids = await insertRows(c, 'thread', threadCols, rows, {
        returning: ['id'],
        returningSchema: IdRow,
      })
      const map = new Map<string, number>()
      threadRows.forEach((t, i) => {
        const idRow = ids[i]
        if (idRow) map.set(t.threadKey, idRow.id)
      })
      return map
    })
  )
  ctx.log(`load threads: ${threadIdByKey.size} (${timings['threads']}ms)`)

  // ── Step 5: messages + parent/root/pull-quote links ─────────────────────────
  const step5 = await timed('messages', () =>
    inTransaction(async (c) => {
      let inserted = 0
      let skipped = 0
      let batch: Record<string, unknown>[] = []
      const flush = async (): Promise<void> => {
        if (batch.length === 0) return
        await insertRows(c, 'message', messageCols, batch)
        inserted += batch.length
        batch = []
      }
      for await (const m of readJsonl(threadedPath, ThreadedMessage)) {
        const threadId = threadIdByKey.get(m.threadKey)
        const posterId = posterIdByKey.get(m.posterKey)
        if (threadId === undefined || posterId === undefined) {
          skipped++
          continue
        }
        batch.push({
          archive_id: archiveId,
          thread_id: threadId,
          poster_id: posterId,
          parent_ref: m.parentRef,
          depth: m.depth,
          message_id: m.messageId,
          subject: m.subject,
          posted_at: m.postedAt,
          body: m.body,
          line_count: m.lineCount,
          is_spam: m.isSpam,
          date_only: m.dateOnly,
        })
        if (batch.length >= 2000) await flush()
      }
      await flush()

      // The rows above are invisible to the planner until analyzed; without
      // this, a second archive's self-join below picks a nested loop and runs
      // for minutes instead of seconds.
      await c.query('ANALYZE message')
      await c.query(
        `UPDATE message m SET parent_id = p.id
         FROM message p
         WHERE m.archive_id = $1 AND p.archive_id = $1 AND m.parent_ref = p.message_id`,
        [archiveId]
      )

      // root_message_id ← the message whose RFC id equals the thread's root id
      const rootThreadIds: number[] = []
      const rootMsgIds: string[] = []
      for (const t of threadRows) {
        const tid = threadIdByKey.get(t.threadKey)
        if (tid !== undefined && t.rootMessageId) {
          rootThreadIds.push(tid)
          rootMsgIds.push(t.rootMessageId)
        }
      }
      if (rootThreadIds.length > 0) {
        await c.query(
          `UPDATE thread t SET root_message_id = m.id
           FROM unnest($1::int[], $2::text[]) AS r(thread_id, msg_id)
           JOIN message m ON m.archive_id = $3 AND m.thread_id = r.thread_id AND m.message_id = r.msg_id
           WHERE t.id = r.thread_id`,
          [rootThreadIds, rootMsgIds, archiveId]
        )
      }

      // slug ← 12 hex of sha256("<show slug>:<earliest message's RFC id>"), so a
      // thread's URL survives reloads (DB ids do not). Mirrors the backfill in
      // migration 20260921060000_thread_slug — keep the two expressions identical.
      await c.query(
        `UPDATE thread t
         SET slug = coalesce(left(encode(sha256(convert_to(s.slug || ':' || (
               SELECT m.message_id FROM message m
               WHERE m.thread_id = t.id ORDER BY m.posted_at, m.id LIMIT 1
             ), 'UTF8')), 'hex'), 12), t.slug)
         FROM show s
         WHERE s.id = t.show_id AND t.archive_id = $1`,
        [archiveId]
      )

      // pull_quote_message_id ← the classified pull-quote's RFC id
      const pqThreadIds: number[] = []
      const pqMsgIds: string[] = []
      for (const t of threadRows) {
        const tid = threadIdByKey.get(t.threadKey)
        const pq = classified.get(t.threadKey)?.classification.pullQuoteMessageId
        if (tid !== undefined && pq) {
          pqThreadIds.push(tid)
          pqMsgIds.push(pq)
        }
      }
      if (pqThreadIds.length > 0) {
        await c.query(
          `UPDATE thread t SET pull_quote_message_id = m.id
           FROM unnest($1::int[], $2::text[]) AS r(thread_id, msg_id)
           JOIN message m ON m.archive_id = $3 AND m.message_id = r.msg_id
           WHERE t.id = r.thread_id`,
          [pqThreadIds, pqMsgIds, archiveId]
        )
      }

      // Threads the classifier flipped to spam drag their messages along, so the
      // archive spam_count and any spam filter stay consistent.
      const spamFlipIds: number[] = []
      for (const t of threadRows) {
        const tid = threadIdByKey.get(t.threadKey)
        if (tid === undefined) continue
        if (!t.isSpam && (classified.get(t.threadKey)?.classification.spamProbability ?? 0) >= 90) {
          spamFlipIds.push(tid)
        }
      }
      let spamFlipped = 0
      if (spamFlipIds.length > 0) {
        const res = await c.query('UPDATE message SET is_spam = true WHERE thread_id = ANY($1)', [
          spamFlipIds,
        ])
        spamFlipped = res.rowCount ?? 0
      }
      return { inserted, skipped, spamFlipped }
    })
  )
  ctx.log(
    `load messages: ${step5.inserted} inserted, ${step5.skipped} skipped, ${step5.spamFlipped} spam-flipped (${timings['messages']}ms)`
  )

  // ── Step 6: thread_episode ──────────────────────────────────────────────────
  const step6 = await timed('thread_episode', () =>
    inTransaction(async (c) => {
      const teRows: Record<string, unknown>[] = []
      const seen = new Set<string>()
      let unknownKeys = 0
      const add = (
        threadId: number,
        startedAtMs: number,
        key: string,
        confidence: number,
        method: string,
        isPrimary: boolean
      ): void => {
        const episodeId = episodeIdByKey.get(key)
        if (episodeId === undefined) {
          unknownKeys++
          return
        }
        const pair = `${threadId}:${episodeId}`
        if (seen.has(pair)) return
        seen.add(pair)
        const airMs = epAirMs.get(key)
        // ET calendar days, per the day-resolution rule (decisions.md 2026-09-21).
        const relation =
          airMs !== undefined && isLive(daysAfterAir(airMs, startedAtMs), ctx.show.liveWindowDays)
            ? 'live'
            : 'retro'
        teRows.push({
          thread_id: threadId,
          episode_id: episodeId,
          relation,
          confidence,
          method,
          is_primary: isPrimary,
        })
      }

      for (const t of threadRows) {
        const threadId = threadIdByKey.get(t.threadKey)
        if (threadId === undefined) continue
        const startedAtMs = Date.parse(t.startedAt)
        const cl = classified.get(t.threadKey)?.classification
        if (cl) {
          if (cl.episode && cl.episodeConfidence >= 40) {
            add(threadId, startedAtMs, cl.episode, cl.episodeConfidence, 'llm', true)
          }
          for (const key of cl.secondaryEpisodes) {
            add(threadId, startedAtMs, key, Math.min(cl.episodeConfidence, 50), 'llm', false)
          }
        } else {
          const top = candidates.get(t.threadKey)?.candidates[0]
          if (top && top.score >= 4) {
            add(
              threadId,
              startedAtMs,
              top.key,
              Math.min(90, Math.round(top.score * 12)),
              'heuristic',
              true
            )
          }
        }
      }
      await insertRows(c, 'thread_episode', teCols, teRows, {
        onConflict: 'ON CONFLICT (thread_id, episode_id) DO NOTHING',
      })
      return { rows: teRows.length, unknownKeys }
    })
  )
  ctx.log(
    `load thread_episode: ${step6.rows} rows, ${step6.unknownKeys} unknown keys (${timings['thread_episode']}ms)`
  )

  // ── Step 7: archive rollups ─────────────────────────────────────────────────
  await timed('archive_counts', () =>
    inTransaction(async (c) => {
      await c.query(
        `UPDATE archive SET
           message_count = (SELECT count(*) FROM message WHERE archive_id = $1),
           thread_count  = (SELECT count(*) FROM thread  WHERE archive_id = $1),
           spam_count    = (SELECT count(*) FROM message WHERE archive_id = $1 AND is_spam),
           first_post_at = (SELECT min(posted_at) FROM message WHERE archive_id = $1),
           last_post_at  = (SELECT max(posted_at) FROM message WHERE archive_id = $1)
         WHERE id = $1`,
        [archiveId]
      )
    })
  )
  ctx.log(`load archive_counts (${timings['archive_counts']}ms)`)

  writeJson(join(work, 'load-summary.json'), {
    showId,
    archiveId,
    seasons: step1.seasons,
    episodes: step1.episodesCount,
    posters: posterIdByKey.size,
    threads: threadIdByKey.size,
    messages: step5.inserted,
    messagesSkipped: step5.skipped,
    messagesSpamFlipped: step5.spamFlipped,
    threadEpisodes: step6.rows,
    unknownEpisodeKeys: step6.unknownKeys,
    timings,
  })
}
