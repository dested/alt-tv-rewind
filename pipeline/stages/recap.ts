// Stage: recap — an Opus 5 lede per episode, generated from the loaded DB (not
// the checkpoints). Runs after load + stats. Reads the episode's counts and its
// live thread highlights via raw SQL, writes the lede back to episode.recap and
// appends recaps.jsonl.
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import Anthropic from '@anthropic-ai/sdk'
import { z } from 'zod'
import { RecapRecord, type Stage } from '../lib/types'
import { checkpointExists, readJsonl, writeJson } from '../lib/checkpoint'
import { pool } from '../lib/db'
import { createClaudeClient } from '../lib/claude'

const CONCURRENCY = 4
const MAX_CHARS = 480
const RATE_INPUT = 5 / 1_000_000
const RATE_OUTPUT = 25 / 1_000_000

const SYSTEM = [
  'You write the lede for an archive page that shows what a Usenet newsgroup said the morning after a TV episode first aired.',
  'Two or three sentences, at most 420 characters. Dry and specific.',
  'Present tense for the discussion (fans split on…), past tense for the airing.',
  'Use only the facts and counts provided and cite at most two numbers. Never name posters.',
  'No exclamation marks, no rhetorical questions, no "Usenet users", no "iconic", "legendary", "epic", "beloved".',
  'Output the lede only — no title, no surrounding quotes, no markdown.',
].join(' ')

const ShowRow = z.object({ id: z.number().int() })
const EpisodeRow = z.object({
  id: z.number().int(),
  season_number: z.number().int(),
  number: z.number().int(),
  title: z.string(),
  air_date: z.string(),
  air_stamp: z.date().nullable(),
  summary: z.string().nullable(),
  tvmaze_rating: z.number().nullable(),
  live_thread_count: z.number().int(),
  live_message_count: z.number().int(),
  live_poster_count: z.number().int(),
  usenet_score: z.number().nullable(),
})
type EpisodeRow = z.infer<typeof EpisodeRow>
const ThreadRow = z.object({
  subject: z.string(),
  message_count: z.number().int(),
  poster_count: z.number().int(),
  kind: z.string().nullable(),
  sentiment: z.string().nullable(),
  summary: z.string().nullable(),
  pull_quote: z.string().nullable(),
  prediction_claim: z.string().nullable(),
  prediction_outcome: z.string().nullable(),
  started_at: z.date(),
})
type ThreadRow = z.infer<typeof ThreadRow>

function episodeKey(e: EpisodeRow): string {
  return `S${String(e.season_number).padStart(2, '0')}E${String(e.number).padStart(2, '0')}`
}

function tally(rows: ThreadRow[], field: 'kind' | 'sentiment'): string {
  const counts: Record<string, number> = {}
  for (const r of rows) {
    const v = r[field]
    if (v) counts[v] = (counts[v] ?? 0) + 1
  }
  return (
    Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .map(([k, n]) => `${k} ${n}`)
      .join(', ') || 'none'
  )
}

function buildBrief(e: EpisodeRow, rows: ThreadRow[]): string {
  const airMs = e.air_stamp ? e.air_stamp.getTime() : Date.parse(e.air_date + 'T00:00:00Z')
  const hoursAfter = (t: ThreadRow): number => Math.round(((t.started_at.getTime() - airMs) / 3.6e6) * 10) / 10

  const top = [...rows]
    .sort((a, b) => b.message_count - a.message_count)
    .slice(0, 6)
    .map(
      (t) =>
        `- "${t.subject}" (${t.message_count} msgs, ${t.poster_count} posters, ${t.kind ?? '?'}/${t.sentiment ?? '?'})${t.summary ? ` — ${t.summary}` : ''}`,
    )
  const quotes = rows
    .filter((t) => t.pull_quote)
    .slice(0, 5)
    .map((t) => `- [+${hoursAfter(t)}h] "${t.pull_quote}"`)
  const predictions = rows
    .filter((t) => t.prediction_claim)
    .slice(0, 4)
    .map((t) => `- ${t.prediction_claim} → ${t.prediction_outcome ?? 'unknown'}`)

  const lines = [
    `Episode: ${episodeKey(e)} "${e.title}" (season ${e.season_number}, episode ${e.number})`,
    `First aired: ${e.air_date}`,
    e.summary ? `TVMaze synopsis: ${e.summary}` : null,
    e.tvmaze_rating !== null ? `TVMaze rating: ${e.tvmaze_rating}` : null,
    `Live discussion: ${e.live_thread_count} threads, ${e.live_message_count} messages, ${e.live_poster_count} posters`,
    e.usenet_score !== null ? `Usenet score: ${e.usenet_score}` : null,
    `Sentiment breakdown: ${tally(rows, 'sentiment')}`,
    `Kind breakdown: ${tally(rows, 'kind')}`,
    top.length > 0 ? `\nTop threads:\n${top.join('\n')}` : null,
    quotes.length > 0 ? `\nPull quotes:\n${quotes.join('\n')}` : null,
    predictions.length > 0 ? `\nPredictions:\n${predictions.join('\n')}` : null,
  ].filter((l): l is string => l !== null)
  return lines.join('\n')
}

type Generated = { text: string; inputTokens: number; outputTokens: number; stopReason: string | null }

async function generate(client: Anthropic, brief: string, maxTokens: number, extra?: string): Promise<Generated> {
  const content = extra ? `${brief}\n\n${extra}` : brief
  const response = await client.beta.messages.create({
    model: 'claude-opus-5',
    max_tokens: maxTokens,
    system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content }],
    output_config: { effort: 'low' },
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
  })
  const text = response.content
    .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('')
    .trim()
    .replace(/\s+/g, ' ')
  const u = response.usage
  return {
    text,
    inputTokens: u.input_tokens + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0),
    outputTokens: u.output_tokens,
    stopReason: response.stop_reason,
  }
}

export const run: Stage['run'] = async (ctx) => {
  const showRes = await pool.query('SELECT id FROM show WHERE slug = $1', [ctx.show.slug])
  const showRow = showRes.rows[0]
  if (!showRow) {
    ctx.log('recap: show not loaded into the DB yet — run load first')
    return
  }
  const showId = ShowRow.parse(showRow).id

  const recapsPath = join(ctx.paths.work, 'recaps.jsonl')
  const done = new Set<string>()
  if (ctx.force) {
    writeFileSync(recapsPath, '')
  } else if (checkpointExists(recapsPath)) {
    for await (const rec of readJsonl(recapsPath, RecapRecord)) done.add(rec.episodeKey)
  }

  const epRes = await pool.query(
    `SELECT id, season_number, number, title, to_char(air_date, 'YYYY-MM-DD') AS air_date, air_stamp,
            summary, tvmaze_rating, live_thread_count, live_message_count, live_poster_count, usenet_score
       FROM episode
      WHERE show_id = $1 AND live_thread_count >= 3
      ORDER BY season_number, number`,
    [showId],
  )
  let episodes = epRes.rows.map((r: unknown) => EpisodeRow.parse(r)).filter((e) => !done.has(episodeKey(e)))
  const limitEnv = process.env.RECAP_LIMIT
  const limit = limitEnv ? Number.parseInt(limitEnv, 10) : undefined
  if (limit !== undefined && Number.isFinite(limit)) episodes = episodes.slice(0, limit)

  if (episodes.length === 0) {
    ctx.log('recap: no episodes to write')
    writeJson(join(ctx.paths.work, 'recap-summary.json'), {
      episodes: 0,
      written: 0,
      skipped: 0,
      tokens: { input: 0, output: 0 },
      estCostUsd: 0,
    })
    return
  }

  const client = createClaudeClient()
  const stats = { written: 0, skipped: 0, input: 0, output: 0 }

  const recapOne = async (e: EpisodeRow): Promise<void> => {
    const threadRes = await pool.query(
      `SELECT t.subject, t.message_count, t.poster_count, t.kind, t.sentiment, t.summary,
              t.pull_quote, t.prediction_claim, t.prediction_outcome, t.started_at
         FROM thread t
         JOIN thread_episode te ON te.thread_id = t.id
        WHERE te.episode_id = $1 AND te.relation = 'live' AND te.is_primary = true AND t.is_spam = false`,
      [e.id],
    )
    const rows = threadRes.rows.map((r: unknown) => ThreadRow.parse(r))
    const brief = buildBrief(e, rows)

    let gen = await generate(client, brief, 600)
    if (gen.stopReason === 'refusal') {
      ctx.log(`recap ${episodeKey(e)}: refused — skipping`)
      stats.skipped++
      stats.input += gen.inputTokens
      stats.output += gen.outputTokens
      return
    }
    if (gen.stopReason === 'max_tokens') {
      const retry = await generate(client, brief, 900)
      stats.input += gen.inputTokens
      stats.output += gen.outputTokens
      gen = retry
    }
    if (gen.text.length > MAX_CHARS) {
      const retry = await generate(client, brief, 900, 'Your previous reply was too long. Keep the lede under 420 characters.')
      stats.input += gen.inputTokens
      stats.output += gen.outputTokens
      gen = retry
    }
    stats.input += gen.inputTokens
    stats.output += gen.outputTokens

    if (!gen.text || gen.text.length > MAX_CHARS) {
      ctx.log(`recap ${episodeKey(e)}: ${gen.text ? `too long (${gen.text.length} chars)` : 'empty'} — skipping`)
      stats.skipped++
      return
    }

    await pool.query('UPDATE episode SET recap = $1, recap_model = $2 WHERE id = $3', [gen.text, 'claude-opus-5', e.id])
    appendFileSync(recapsPath, JSON.stringify(RecapRecord.parse({ episodeKey: episodeKey(e), model: 'claude-opus-5', recap: gen.text })) + '\n')
    stats.written++
  }

  let cursor = 0
  const worker = async (): Promise<void> => {
    for (;;) {
      const i = cursor++
      if (i >= episodes.length) return
      const e = episodes[i]
      if (!e) return
      await recapOne(e)
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, episodes.length) }, () => worker()))

  writeJson(join(ctx.paths.work, 'recap-summary.json'), {
    episodes: episodes.length,
    written: stats.written,
    skipped: stats.skipped,
    tokens: { input: stats.input, output: stats.output },
    estCostUsd: Number((stats.input * RATE_INPUT + stats.output * RATE_OUTPUT).toFixed(4)),
  })
  ctx.log(
    `recapped ${stats.written} episodes (${stats.skipped} skipped) · ${stats.input} in / ${stats.output} out tokens · $${(stats.input * RATE_INPUT + stats.output * RATE_OUTPUT).toFixed(4)}`,
  )
}
