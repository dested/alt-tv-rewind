// Stage: classify — one Jev "System One" call per non-spam thread, turning the
// opener + early replies into calibrated episode / kind / sentiment / hot-take /
// spam / pull-quote decisions. Reads threads.jsonl, threaded.jsonl,
// episodes.json and (optionally) candidates.jsonl; appends classified.jsonl and
// classify-errors.jsonl, and writes classify-summary.json.
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { TypeSafeError } from '@typesafe-ai/sdk'
import {
  CandidateRecord,
  ClassifiedRecord,
  EpisodesFile,
  type EpisodeRecord,
  type Stage,
} from '../lib/types'
import { checkpointExists, readJsonl, writeJson } from '../lib/checkpoint'
import { collectThreadInputs, type ThreadInput } from '../lib/thread-text'
import { buildQuestions, buildState, createJevClient, toClassification } from '../lib/jev'

const OPENER_CHARS = 2000
const REPLY_CHARS = 800
const MAX_REPLIES = 4
const CONCURRENCY = 16
const RATE_PER_SEC = 18
const PRICE_PER_INPUT_TOKEN = 0.042 / 1_000_000
const DAY_MS = 86_400_000
const MAX_EPISODE_LABELS = 254 // 255 minus the 'none' label

// Token bucket: at most RATE_PER_SEC new requests dispatched per second.
class RateLimiter {
  private tokens: number
  private last = Date.now()
  constructor(private readonly rate: number) {
    this.tokens = rate
  }
  async take(): Promise<void> {
    for (;;) {
      const now = Date.now()
      this.tokens = Math.min(this.rate, this.tokens + ((now - this.last) / 1000) * this.rate)
      this.last = now
      if (this.tokens >= 1) {
        this.tokens -= 1
        return
      }
      await new Promise((r) => setTimeout(r, ((1 - this.tokens) / this.rate) * 1000))
    }
  }
}

function windowHint(sig: string, ep: EpisodeRecord, key: string): string | null {
  const m = sig.match(/^window:([+-]?\d+(?:\.\d+)?)d$/)
  if (!m) return null
  const days = Number(m[1])
  if (days < 0) return null
  return `Started ${m[1]!.replace(/^\+/, '')} days after ${key} ${ep.title} first aired (${ep.airDate})`
}

function hintsFromCandidates(
  rec: CandidateRecord | undefined,
  byKey: Map<string, EpisodeRecord>
): string[] {
  if (!rec) return []
  const hints: string[] = []
  const seen = new Set<string>()
  const push = (h: string): void => {
    if (seen.has(h)) return
    seen.add(h)
    hints.push(h)
  }
  for (const c of rec.candidates) {
    const ep = byKey.get(c.key)
    if (!ep) continue
    for (const sig of c.signals) {
      if (sig.startsWith('window:')) {
        const h = windowHint(sig, ep, c.key)
        if (h) push(h)
      } else if (sig.startsWith('alias:') || sig.startsWith('title:')) {
        const rest = sig.slice(sig.indexOf(':') + 1)
        const phrase = rest === 'subject' || rest === 'body' ? ep.title : rest
        push(`Mentions '${phrase}' — associated with ${c.key} ${ep.title}`)
      }
      if (hints.length >= 4) return hints
    }
  }
  return hints
}

function hintsFromEpisodes(
  startedAt: string,
  episodes: EpisodeRecord[],
  liveWindowDays: number
): string[] {
  const startedMs = Date.parse(startedAt)
  const near: Array<{ days: number; hint: string }> = []
  for (const ep of episodes) {
    const days = (startedMs - Date.parse(ep.airDate + 'T00:00:00Z')) / DAY_MS
    if (days >= 0 && days <= liveWindowDays) {
      near.push({
        days,
        hint: `Started ${days.toFixed(1)} days after ${ep.key} ${ep.title} first aired (${ep.airDate})`,
      })
    }
  }
  return near
    .sort((a, b) => a.days - b.days)
    .slice(0, 4)
    .map((n) => n.hint)
}

export const run: Stage['run'] = async (ctx) => {
  const episodesFile = EpisodesFile.parse(JSON.parse(readFileSync(ctx.paths.episodesFile, 'utf8')))
  const episodes = episodesFile.episodes
  const byKey = new Map(episodes.map((e) => [e.key, e]))

  const candByThread = new Map<string, CandidateRecord>()
  const candPath = join(ctx.paths.work, 'candidates.jsonl')
  const haveCandidates = checkpointExists(candPath)
  if (haveCandidates) {
    for await (const c of readJsonl(candPath, CandidateRecord)) candByThread.set(c.threadKey, c)
  }

  const inputs = await collectThreadInputs(ctx, {
    openerChars: OPENER_CHARS,
    replyChars: REPLY_CHARS,
    maxReplies: MAX_REPLIES,
    filter: (t) => !t.isSpam,
  })

  const all = [...inputs.values()].sort((a, b) =>
    a.startedAt < b.startedAt ? -1 : a.startedAt > b.startedAt ? 1 : 0
  )
  const limitEnv = process.env.CLASSIFY_LIMIT
  const limit = limitEnv ? Number.parseInt(limitEnv, 10) : undefined
  const selected = limit !== undefined && Number.isFinite(limit) ? all.slice(0, limit) : all

  const hintsFor = (input: ThreadInput): string[] =>
    haveCandidates
      ? hintsFromCandidates(candByThread.get(input.threadKey), byKey)
      : hintsFromEpisodes(input.startedAt, episodes, ctx.show.liveWindowDays)

  // Jev caps a choice at 255 labels. Shows with more episodes than that get a
  // per-thread roster: the attribute stage's candidates first, then the episodes
  // most recently aired before the thread started, up to the cap. An old episode
  // a late thread revisits only makes the roster through a title/alias candidate.
  const byAirDesc = [...episodes].sort((a, b) =>
    a.airDate < b.airDate ? 1 : a.airDate > b.airDate ? -1 : 0
  )
  const episodesFor = (input: ThreadInput): EpisodeRecord[] => {
    if (episodes.length <= MAX_EPISODE_LABELS) return episodes
    const chosen = new Set<string>()
    for (const c of candByThread.get(input.threadKey)?.candidates ?? []) {
      if (byKey.has(c.key)) chosen.add(c.key)
    }
    const cutoff = input.startedAt.slice(0, 10)
    for (const ep of byAirDesc) {
      if (chosen.size >= MAX_EPISODE_LABELS) break
      if (ep.airDate <= cutoff) chosen.add(ep.key)
    }
    return episodes.filter((ep) => chosen.has(ep.key))
  }

  const showCtx = { showName: ctx.show.name, newsgroup: ctx.show.newsgroup }

  // Dry run: emit two fully built payloads + a token/cost estimate, no API call.
  if (process.env.CLASSIFY_DRY_RUN === '1') {
    const samples: Array<{ threadKey: string; state: unknown; questions: unknown }> = []
    let totalTokens = 0
    for (const input of selected) {
      const questions = buildQuestions(episodesFor(input), input.candidateLines)
      const state = buildState(input, { ...showCtx, hints: hintsFor(input) })
      const tokens = Math.ceil(JSON.stringify({ state, questions }).length / 4)
      totalTokens += tokens
      if (samples.length < 2) {
        samples.push({ threadKey: input.threadKey, state, questions })
        ctx.log(`dry-run request ${input.threadKey}: ~${tokens} tokens`)
      }
    }
    writeJson(join(ctx.paths.work, 'classify-dryrun.json'), samples)
    const cost = totalTokens * PRICE_PER_INPUT_TOKEN
    ctx.log(
      `dry-run: ${selected.length} requests, ~${totalTokens} input tokens total, est cost $${cost.toFixed(4)} at $0.042/M`
    )
    return
  }

  const classifiedPath = join(ctx.paths.work, 'classified.jsonl')
  const errorsPath = join(ctx.paths.work, 'classify-errors.jsonl')

  const done = new Set<string>()
  if (ctx.force) {
    writeFileSync(classifiedPath, '')
    writeFileSync(errorsPath, '')
  } else if (checkpointExists(classifiedPath)) {
    for await (const rec of readJsonl(classifiedPath, ClassifiedRecord)) done.add(rec.threadKey)
  }

  const todo = selected.filter((i) => !done.has(i.threadKey))
  if (todo.length === 0) {
    ctx.log('classify: nothing to do (all selected threads already classified)')
    return
  }

  const client = createJevClient()
  const model = process.env.JEV_MODEL ?? 'jev-latest'
  const limiter = new RateLimiter(RATE_PER_SEC)
  const started = Date.now()

  const stats = {
    classified: 0,
    errors: 0,
    episodeAttributed: 0,
    byKind: {} as Record<string, number>,
    bySentiment: {} as Record<string, number>,
    hotTakes: 0,
    spamFlagged: 0,
    confidenceSum: 0,
    inputTokens: 0,
  }
  const firstOutcomes: boolean[] = [] // true = errored
  let abortError: unknown = null
  let completed = 0

  async function classifyOne(input: ThreadInput): Promise<void> {
    if (abortError) return
    const questions = buildQuestions(episodesFor(input), input.candidateLines)
    const state = buildState(input, { ...showCtx, hints: hintsFor(input) })
    await limiter.take()
    try {
      const result = await client.systemOne({ state, questions, model })
      const classification = toClassification(result.answers, input)
      const record: ClassifiedRecord = {
        threadKey: input.threadKey,
        model: result.model,
        classification,
        inputTokens: result.usage.input_tokens,
        outputTokens: result.usage.output_tokens,
      }
      appendFileSync(classifiedPath, JSON.stringify(record) + '\n')
      stats.classified++
      stats.inputTokens += result.usage.input_tokens
      stats.confidenceSum += classification.episodeConfidence
      if (classification.episode && classification.episodeConfidence >= 40)
        stats.episodeAttributed++
      stats.byKind[classification.kind] = (stats.byKind[classification.kind] ?? 0) + 1
      stats.bySentiment[classification.sentiment] =
        (stats.bySentiment[classification.sentiment] ?? 0) + 1
      if (classification.hotTake) stats.hotTakes++
      if (classification.spamProbability >= 90) stats.spamFlagged++
      if (completed < 5) firstOutcomes.push(false)
    } catch (e) {
      if (!(e instanceof TypeSafeError)) throw e
      appendFileSync(
        errorsPath,
        JSON.stringify({ threadKey: input.threadKey, error: e.message }) + '\n'
      )
      stats.errors++
      if (completed < 5) firstOutcomes.push(true)
    } finally {
      completed++
      if (completed === 5 && firstOutcomes.length === 5 && firstOutcomes.every((x) => x)) {
        abortError = new Error(
          'classify: first 5 requests all failed — aborting (check TYPESAFE_API_KEY / service status)'
        )
      }
      if (completed % 500 === 0) {
        const secs = (Date.now() - started) / 1000
        ctx.log(
          `classify ${completed}/${todo.length} · ${(completed / secs).toFixed(1)} req/s · ${stats.inputTokens} in-tok · $${(stats.inputTokens * PRICE_PER_INPUT_TOKEN).toFixed(4)}`
        )
      }
    }
  }

  let cursor = 0
  async function worker(): Promise<void> {
    while (!abortError) {
      const i = cursor++
      if (i >= todo.length) return
      const input = todo[i]
      if (!input) return
      await classifyOne(input)
    }
  }

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, todo.length) }, () => worker()))
  if (abortError) throw abortError

  const durationMs = Date.now() - started
  writeJson(join(ctx.paths.work, 'classify-summary.json'), {
    threads: selected.length,
    classified: stats.classified,
    errors: stats.errors,
    episodeAttributed: stats.episodeAttributed,
    byKind: stats.byKind,
    bySentiment: stats.bySentiment,
    hotTakes: stats.hotTakes,
    spamFlagged: stats.spamFlagged,
    meanEpisodeConfidence:
      stats.classified > 0 ? Math.round(stats.confidenceSum / stats.classified) : 0,
    inputTokens: stats.inputTokens,
    estCostUsd: Number((stats.inputTokens * PRICE_PER_INPUT_TOKEN).toFixed(4)),
    durationMs,
  })
  ctx.log(
    `classified ${stats.classified} threads (${stats.errors} errors), ${stats.inputTokens} input tokens, $${(stats.inputTokens * PRICE_PER_INPUT_TOKEN).toFixed(4)} in ${(durationMs / 1000).toFixed(1)}s`
  )
}
