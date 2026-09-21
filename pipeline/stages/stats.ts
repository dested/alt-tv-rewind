// Stage: stats — recompute all denormalized counters for a show from the loaded
// rows. Pure SQL keyed by show_id. Safe to re-run; every counter is reset before
// it is recomputed.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'
import { EpisodesFile, PhrasesFile, type Stage } from '../lib/types'
import { buildEpisodeIndex } from '../lib/episode-index'
import { insertRows, inTransaction, withClient } from '../lib/db'
import { writeJson } from '../lib/checkpoint'

const IdRow = z.object({ id: z.number().int() })
const MonthlyRow = z.object({ month: z.string(), c: z.number().int() })
const FirstRow = z.object({ id: z.number().int(), first_at: z.string() })
const TopEpisodeRow = z.object({ slug: z.string(), title: z.string(), live_message_count: z.number().int() })
const PhraseTotalRow = z.object({ slug: z.string(), label: z.string(), total_count: z.number().int() })

export const run: Stage['run'] = async (ctx) => {
  const episodes = EpisodesFile.parse(JSON.parse(readFileSync(ctx.paths.episodesFile, 'utf8')))
  const phrases = PhrasesFile.parse(JSON.parse(readFileSync(ctx.paths.phrasesFile, 'utf8')))
  const index = buildEpisodeIndex(episodes, {})

  const showId = await withClient(async (c) => {
    const res = await c.query('SELECT id FROM show WHERE slug = $1', [ctx.show.slug])
    const row = res.rows[0]
    if (row === undefined) throw new Error(`stats: show "${ctx.show.slug}" not loaded`)
    return IdRow.parse(row).id
  })

  const archiveIds = await withClient(async (c) => {
    const res = await c.query('SELECT id FROM archive WHERE show_id = $1', [showId])
    const rows: unknown[] = res.rows
    return rows.map((r) => IdRow.parse(r).id)
  })

  // ── counters ────────────────────────────────────────────────────────────────
  await inTransaction(async (c) => {
    // reset episode counters
    await c.query(
      `UPDATE episode SET live_thread_count=0, live_message_count=0, live_poster_count=0,
         retro_thread_count=0, retro_message_count=0, usenet_score=NULL WHERE show_id=$1`,
      [showId],
    )
    // episode counters from primary attributions on non-spam threads
    await c.query(
      `WITH pe AS (
         SELECT te.episode_id, te.relation, t.message_count, t.sentiment
         FROM thread_episode te
         JOIN thread t ON t.id = te.thread_id
         WHERE te.is_primary AND t.show_id = $1 AND NOT t.is_spam
       ),
       agg AS (
         SELECT episode_id,
           count(*) FILTER (WHERE relation='live')  AS live_threads,
           coalesce(sum(message_count) FILTER (WHERE relation='live'), 0)  AS live_msgs,
           count(*) FILTER (WHERE relation='retro') AS retro_threads,
           coalesce(sum(message_count) FILTER (WHERE relation='retro'), 0) AS retro_msgs,
           count(*) FILTER (WHERE relation='live' AND sentiment IN ('loved','liked','mixed','disliked','hated')) AS rated,
           count(*) FILTER (WHERE relation='live' AND sentiment IN ('loved','liked')) AS positives,
           count(*) FILTER (WHERE relation='live' AND sentiment IN ('hated','disliked')) AS negatives
         FROM pe GROUP BY episode_id
       ),
       lp AS (
         SELECT te.episode_id, count(DISTINCT m.poster_id) AS live_posters
         FROM thread_episode te
         JOIN thread t ON t.id = te.thread_id
         JOIN message m ON m.thread_id = t.id AND NOT m.is_spam
         WHERE te.is_primary AND t.show_id = $1 AND NOT t.is_spam AND te.relation='live'
         GROUP BY te.episode_id
       )
       UPDATE episode e SET
         live_thread_count   = agg.live_threads,
         live_message_count  = agg.live_msgs,
         retro_thread_count  = agg.retro_threads,
         retro_message_count = agg.retro_msgs,
         live_poster_count   = coalesce(lp.live_posters, 0),
         usenet_score = CASE WHEN agg.rated >= 3 THEN (agg.positives - agg.negatives)::float / agg.rated ELSE NULL END
       FROM agg LEFT JOIN lp ON lp.episode_id = agg.episode_id
       WHERE e.id = agg.episode_id`,
      [showId],
    )
    // season counters from their episodes
    await c.query('UPDATE season SET live_message_count=0, retro_message_count=0 WHERE show_id=$1', [showId])
    await c.query(
      `UPDATE season s SET live_message_count = agg.lm, retro_message_count = agg.rm
       FROM (SELECT season_id, sum(live_message_count) AS lm, sum(retro_message_count) AS rm
             FROM episode WHERE show_id=$1 GROUP BY season_id) agg
       WHERE s.id = agg.season_id`,
      [showId],
    )
    // controversy for hot-take threads
    await c.query(
      `UPDATE thread SET controversy =
         CASE WHEN hot_take THEN LEAST(100, poster_count*4 + max_depth*3 + LEAST(message_count, 40)) ELSE 0 END
       WHERE show_id=$1`,
      [showId],
    )
    // poster counters (global recompute for posters seen in this show's archives)
    await c.query(
      `WITH touched AS (
         SELECT DISTINCT m.poster_id
         FROM message m JOIN archive a ON a.id = m.archive_id WHERE a.show_id = $1
       ),
       msg AS (
         SELECT poster_id, count(*) AS mc, min(posted_at) AS fp, max(posted_at) AS lp
         FROM message WHERE poster_id IN (SELECT poster_id FROM touched) GROUP BY poster_id
       ),
       th AS (
         SELECT rm.poster_id,
           count(*) AS tc,
           count(*) FILTER (WHERE t.kind='prediction' AND t.prediction_outcome IN ('came_true','did_not')) AS pc,
           count(*) FILTER (WHERE t.kind='prediction' AND t.prediction_outcome='came_true') AS ph
         FROM thread t JOIN message rm ON rm.id = t.root_message_id
         WHERE rm.poster_id IN (SELECT poster_id FROM touched) GROUP BY rm.poster_id
       )
       UPDATE poster p SET
         message_count = coalesce(msg.mc, 0),
         first_post_at = msg.fp,
         last_post_at  = msg.lp,
         thread_count  = coalesce(th.tc, 0),
         prediction_count = coalesce(th.pc, 0),
         prediction_hits  = coalesce(th.ph, 0)
       FROM touched
       LEFT JOIN msg ON msg.poster_id = touched.poster_id
       LEFT JOIN th  ON th.poster_id  = touched.poster_id
       WHERE p.id = touched.poster_id`,
      [showId],
    )
    // daily volume
    await c.query('DELETE FROM daily_volume WHERE show_id=$1', [showId])
    await c.query(
      `INSERT INTO daily_volume (show_id, day, message_count, thread_count)
       SELECT $1, msgs.day, msgs.mc, coalesce(ths.tc, 0)
       FROM (
         SELECT (m.posted_at AT TIME ZONE 'UTC')::date AS day, count(*) AS mc
         FROM message m JOIN archive a ON a.id = m.archive_id
         WHERE a.show_id = $1 AND NOT m.is_spam GROUP BY 1
       ) msgs
       LEFT JOIN (
         SELECT (started_at AT TIME ZONE 'UTC')::date AS day, count(*) AS tc
         FROM thread WHERE show_id = $1 AND NOT is_spam GROUP BY 1
       ) ths ON ths.day = msgs.day`,
      [showId],
    )
  })

  // ── phrases ───────────────────────────────────────────────────────────────
  await inTransaction(async (c) => {
    const slugs = phrases.map((p) => p.slug)
    await c.query('DELETE FROM phrase WHERE show_id=$1 AND slug <> ALL($2::text[])', [showId, slugs])

    for (const phrase of phrases) {
      const episodeSlug = phrase.episode ? (index.resolveTitle(phrase.episode)[0]?.slug ?? null) : null
      const up = await c.query(
        `INSERT INTO phrase (show_id, slug, label, pattern, episode_slug)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (show_id, slug) DO UPDATE SET label=EXCLUDED.label, pattern=EXCLUDED.pattern, episode_slug=EXCLUDED.episode_slug
         RETURNING id`,
        [showId, phrase.slug, phrase.label, phrase.pattern, episodeSlug],
      )
      const phraseId = IdRow.parse(up.rows[0]).id
      await c.query('DELETE FROM phrase_monthly WHERE phrase_id=$1', [phraseId])

      if (archiveIds.length === 0) continue
      // Postgres ARE has no \b word boundary — translate to \y before matching.
      const pgPattern = phrase.pattern.replace(/\\b/g, '\\y')

      const monthlyRes = await c.query(
        `SELECT to_char(date_trunc('month', posted_at), 'YYYY-MM-DD') AS month, count(*)::int AS c
         FROM message WHERE archive_id = ANY($1) AND NOT is_spam AND (subject ~* $2 OR body ~* $2)
         GROUP BY 1 ORDER BY 1`,
        [archiveIds, pgPattern],
      )
      const monthlyRaw: unknown[] = monthlyRes.rows
      const monthly = monthlyRaw.map((r) => MonthlyRow.parse(r))
      const total = monthly.reduce((sum, m) => sum + m.c, 0)

      if (monthly.length > 0) {
        await insertRows(
          c,
          'phrase_monthly',
          [
            { name: 'phrase_id', type: 'int' },
            { name: 'month', type: 'date' },
            { name: 'count', type: 'int' },
          ],
          monthly.map((m) => ({ phrase_id: phraseId, month: m.month, count: m.c })),
        )
      }

      const firstRes = await c.query(
        `SELECT id, to_char(posted_at, 'YYYY-MM-DD HH24:MI:SS.MS') AS first_at
         FROM message WHERE archive_id = ANY($1) AND NOT is_spam AND (subject ~* $2 OR body ~* $2)
         ORDER BY posted_at LIMIT 1`,
        [archiveIds, pgPattern],
      )
      const firstRaw = firstRes.rows[0]
      const first = firstRaw === undefined ? null : FirstRow.parse(firstRaw)
      await c.query('UPDATE phrase SET first_message_id=$2, first_at=$3, total_count=$4 WHERE id=$1', [
        phraseId,
        first?.id ?? null,
        first?.first_at ?? null,
        total,
      ])
    }
  })

  // ── summary ─────────────────────────────────────────────────────────────────
  const summary = await withClient(async (c) => {
    const topRes = await c.query(
      `SELECT slug, title, live_message_count FROM episode WHERE show_id=$1 ORDER BY live_message_count DESC, slug LIMIT 10`,
      [showId],
    )
    const phraseRes = await c.query(
      `SELECT slug, label, total_count FROM phrase WHERE show_id=$1 ORDER BY total_count DESC, slug`,
      [showId],
    )
    const topRaw: unknown[] = topRes.rows
    const phraseRaw: unknown[] = phraseRes.rows
    return {
      topEpisodes: topRaw.map((r) => TopEpisodeRow.parse(r)),
      phrases: phraseRaw.map((r) => PhraseTotalRow.parse(r)),
    }
  })

  writeJson(join(ctx.paths.work, 'stats-summary.json'), summary)
  ctx.log(
    `stats: recomputed counters; top episode ${summary.topEpisodes[0]?.slug ?? '—'} ` +
      `(${summary.topEpisodes[0]?.live_message_count ?? 0} live msgs), ${summary.phrases.length} phrases`,
  )
}
