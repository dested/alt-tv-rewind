// Stage: enrich — a Haiku Message Batch that writes the one-sentence summary and
// grades prediction threads. Only threads that surface in the UI or are
// predictions are sent. Reads classified.jsonl + threads/threaded.jsonl +
// episodes.json; appends enriched.jsonl and enrich-errors.jsonl; tracks batches
// in enrich-batches.json so a crash never re-submits (never double-spends).
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import Anthropic from '@anthropic-ai/sdk'
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import { z } from 'zod'
import { ClassifiedRecord, EnrichedRecord, EpisodesFile, type EpisodeRecord, type Stage } from '../lib/types'
import { checkpointExists, readJsonl, writeJson } from '../lib/checkpoint'
import { collectThreadInputs, type ThreadInput } from '../lib/thread-text'
import {
  buildEnrichSystem,
  buildEnrichUser,
  createClaudeClient,
  ENRICH_TOOL,
  ENRICH_TOOL_NAME,
  EnrichOutput,
  probeStructuredOutputs,
  type EnrichOutputData,
} from '../lib/claude'

const OPENER_CHARS = 1600
const REPLY_CHARS = 500
const MAX_REPLIES = 3
const CHUNK = 5000
const POLL_MS = 30_000
// Batch rates supplied by the task brief (Haiku 4.5).
const RATE_INPUT = 0.5 / 1_000_000
const RATE_CACHE_READ = 0.05 / 1_000_000
const RATE_OUTPUT = 2.5 / 1_000_000

const BatchEntry = z.object({
  id: z.string(),
  threadKeys: z.array(z.string()),
  createdAt: z.string(),
  status: z.enum(['pending', 'done']),
})
type BatchEntry = z.infer<typeof BatchEntry>
const BatchesFile = z.object({ batches: z.array(BatchEntry) })

type Mode = 'output_config' | 'strict_tool'
type ReqData = { input: ThreadInput; meta: Parameters<typeof buildEnrichUser>[1] }

function selects(rec: ClassifiedRecord, messageCount: number): boolean {
  const c = rec.classification
  if (c.spamProbability >= 90) return false
  if (c.episode !== null && c.episodeConfidence >= 40 && messageCount >= 2) return true
  if (c.kind === 'prediction') return true
  if (messageCount >= 5) return true
  return false
}

function metaFor(input: ThreadInput, rec: ClassifiedRecord, byKey: Map<string, EpisodeRecord>): ReqData['meta'] {
  const c = rec.classification
  const ep = c.episode ? byKey.get(c.episode) : undefined
  if (!ep) return { kind: c.kind, sentiment: c.sentiment, episode: null, hoursAfterAir: null }
  const airMs = ep.airStamp ? Date.parse(ep.airStamp) : Date.parse(ep.airDate + 'T00:00:00Z')
  return {
    kind: c.kind,
    sentiment: c.sentiment,
    episode: { key: ep.key, title: ep.title, airDate: ep.airDate },
    hoursAfterAir: Math.round(((Date.parse(input.startedAt) - airMs) / 3.6e6) * 10) / 10,
  }
}

function buildParams(system: string, data: ReqData, mode: Mode): Anthropic.Messages.MessageCreateParamsNonStreaming {
  const base = {
    model: 'claude-haiku-4-5',
    max_tokens: 400,
    system: [{ type: 'text' as const, text: system, cache_control: { type: 'ephemeral' as const } }],
    messages: [{ role: 'user' as const, content: buildEnrichUser(data.input, data.meta) }],
  }
  return mode === 'output_config'
    ? { ...base, output_config: { format: zodOutputFormat(EnrichOutput) } }
    : { ...base, tools: [ENRICH_TOOL], tool_choice: { type: 'tool', name: ENRICH_TOOL_NAME } }
}

function extractEnrich(message: Anthropic.Message, mode: Mode): EnrichOutputData | null {
  try {
    if (mode === 'output_config') {
      const text = message.content.find((b): b is Anthropic.TextBlock => b.type === 'text')
      if (!text) return null
      return EnrichOutput.parse(JSON.parse(text.text))
    }
    const tool = message.content.find(
      (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use' && b.name === ENRICH_TOOL_NAME,
    )
    if (!tool) return null
    return EnrichOutput.parse(tool.input)
  } catch {
    return null
  }
}

export const run: Stage['run'] = async (ctx) => {
  const episodesFile = EpisodesFile.parse(JSON.parse(readFileSync(ctx.paths.episodesFile, 'utf8')))
  const episodes = episodesFile.episodes
  const byKey = new Map(episodes.map((e) => [e.key, e]))

  // classified.jsonl → the pool of classifications to consider.
  const classified = new Map<string, ClassifiedRecord>()
  const classifiedPath = join(ctx.paths.work, 'classified.jsonl')
  if (!checkpointExists(classifiedPath)) {
    ctx.log('enrich: no classified.jsonl — run classify first')
    return
  }
  for await (const rec of readJsonl(classifiedPath, ClassifiedRecord)) classified.set(rec.threadKey, rec)

  const inputs = await collectThreadInputs(ctx, {
    openerChars: OPENER_CHARS,
    replyChars: REPLY_CHARS,
    maxReplies: MAX_REPLIES,
    filter: (t) => classified.has(t.threadKey),
  })

  const requestData = new Map<string, ReqData>()
  for (const [threadKey, input] of inputs) {
    const rec = classified.get(threadKey)
    if (!rec || !selects(rec, input.messageCount)) continue
    requestData.set(threadKey, { input, meta: metaFor(input, rec, byKey) })
  }

  let selectedKeys = [...requestData.keys()].sort((a, b) => {
    const ta = requestData.get(a)!.input.startedAt
    const tb = requestData.get(b)!.input.startedAt
    return ta < tb ? -1 : ta > tb ? 1 : 0
  })
  const limitEnv = process.env.ENRICH_LIMIT
  const limit = limitEnv ? Number.parseInt(limitEnv, 10) : undefined
  if (limit !== undefined && Number.isFinite(limit)) selectedKeys = selectedKeys.slice(0, limit)

  const system = buildEnrichSystem({ ...episodesFile.show, newsgroup: ctx.show.newsgroup }, episodes)

  if (process.env.ENRICH_DRY_RUN === '1') {
    const samples = selectedKeys.slice(0, 2).map((k) => ({
      custom_id: k,
      params: buildParams(system, requestData.get(k)!, 'output_config'),
    }))
    writeJson(join(ctx.paths.work, 'enrich-dryrun.json'), samples)
    const systemTokens = Math.ceil(system.length / 4)
    let userTokens = 0
    for (const k of selectedKeys) {
      userTokens += Math.ceil(buildEnrichUser(requestData.get(k)!.input, requestData.get(k)!.meta).length / 4)
    }
    ctx.log(
      `dry-run: ${selectedKeys.length} requests · system ~${systemTokens} tokens (cached once) · user ~${userTokens} tokens total`,
    )
    return
  }

  const enrichedPath = join(ctx.paths.work, 'enriched.jsonl')
  const errorsPath = join(ctx.paths.work, 'enrich-errors.jsonl')
  const batchesPath = join(ctx.paths.work, 'enrich-batches.json')

  const registry: BatchEntry[] = []
  if (ctx.force) {
    for (const p of [enrichedPath, errorsPath]) writeFileSync(p, '')
    writeJson(batchesPath, { batches: [] })
  } else {
    if (checkpointExists(batchesPath)) {
      registry.push(...BatchesFile.parse(JSON.parse(readFileSync(batchesPath, 'utf8'))).batches)
    }
  }

  const enrichedKeys = new Set<string>()
  if (!ctx.force && checkpointExists(enrichedPath)) {
    for await (const rec of readJsonl(enrichedPath, EnrichedRecord)) enrichedKeys.add(rec.threadKey)
  }
  const errorKeys = new Set<string>()
  if (!ctx.force && checkpointExists(errorsPath)) {
    const raw = readFileSync(errorsPath, 'utf8')
    for (const line of raw.split('\n')) {
      const t = line.trim()
      if (!t) continue
      const parsed = z.object({ threadKey: z.string() }).safeParse(JSON.parse(t))
      if (parsed.success) errorKeys.add(parsed.data.threadKey)
    }
  }

  if (selectedKeys.length === 0) {
    ctx.log('enrich: no threads qualify for enrichment')
    writeJson(join(ctx.paths.work, 'enrich-summary.json'), emptySummary())
    return
  }

  const client = createClaudeClient()
  const mode = await probeStructuredOutputs(client)
  ctx.log(`enrich: structured-output mode = ${mode}`)

  const persist = (): void => writeJson(batchesPath, { batches: registry })
  const stats = {
    enriched: 0,
    errors: 0,
    predictions: { came_true: 0, did_not: 0, unknown: 0 } as Record<string, number>,
    input: 0,
    cacheRead: 0,
    cacheCreate: 0,
    output: 0,
  }

  const drain = async (entry: BatchEntry, final: boolean): Promise<string[]> => {
    for (;;) {
      const b = await client.messages.batches.retrieve(entry.id)
      if (b.processing_status === 'ended') break
      ctx.log(
        `batch ${entry.id}: ${b.processing_status} · processing ${b.request_counts.processing} · ok ${b.request_counts.succeeded} · err ${b.request_counts.errored}`,
      )
      await new Promise((r) => setTimeout(r, POLL_MS))
    }
    const retry: string[] = []
    for await (const r of await client.messages.batches.results(entry.id)) {
      const key = r.custom_id
      switch (r.result.type) {
        case 'succeeded': {
          const message = r.result.message
          const parsed = extractEnrich(message, mode)
          if (!parsed) {
            appendFileSync(errorsPath, JSON.stringify({ threadKey: key, error: 'unparseable output' }) + '\n')
            stats.errors++
            break
          }
          const u = message.usage
          const record = EnrichedRecord.parse({
            threadKey: key,
            model: message.model,
            summary: parsed.summary,
            predictionClaim: parsed.predictionClaim,
            predictionOutcome: parsed.predictionOutcome,
            inputTokens: u.input_tokens + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0),
            outputTokens: u.output_tokens,
          })
          appendFileSync(enrichedPath, JSON.stringify(record) + '\n')
          stats.enriched++
          stats.input += u.input_tokens
          stats.cacheRead += u.cache_read_input_tokens ?? 0
          stats.cacheCreate += u.cache_creation_input_tokens ?? 0
          stats.output += u.output_tokens
          if (record.predictionOutcome) stats.predictions[record.predictionOutcome]!++
          break
        }
        case 'errored': {
          if (r.result.error.error.type === 'invalid_request_error' || final) {
            appendFileSync(
              errorsPath,
              JSON.stringify({ threadKey: key, error: r.result.error.error.message }) + '\n',
            )
            stats.errors++
          } else {
            retry.push(key)
          }
          break
        }
        case 'expired': {
          if (final) {
            appendFileSync(errorsPath, JSON.stringify({ threadKey: key, error: 'expired' }) + '\n')
            stats.errors++
          } else {
            retry.push(key)
          }
          break
        }
        case 'canceled': {
          appendFileSync(errorsPath, JSON.stringify({ threadKey: key, error: 'canceled' }) + '\n')
          stats.errors++
          break
        }
      }
    }
    entry.status = 'done'
    persist()
    return retry
  }

  // Resume: resolve any batch left pending by a previous run before creating new
  // ones, so its threads are never submitted twice.
  const retryKeys: string[] = []
  const pendingKeys = new Set<string>()
  for (const entry of registry) {
    if (entry.status !== 'pending') continue
    for (const k of entry.threadKeys) pendingKeys.add(k)
    retryKeys.push(...(await drain(entry, false)))
  }

  const submit = async (keys: string[], final: boolean): Promise<string[]> => {
    const retry: string[] = []
    for (let i = 0; i < keys.length; i += CHUNK) {
      const chunk = keys.slice(i, i + CHUNK)
      const requests = chunk.map((k) => ({ custom_id: k, params: buildParams(system, requestData.get(k)!, mode) }))
      const batch = await client.messages.batches.create({ requests })
      const entry: BatchEntry = {
        id: batch.id,
        threadKeys: chunk,
        createdAt: new Date().toISOString(),
        status: 'pending',
      }
      registry.push(entry)
      persist()
      retry.push(...(await drain(entry, final)))
    }
    return retry
  }

  const fresh = selectedKeys.filter((k) => !enrichedKeys.has(k) && !errorKeys.has(k) && !pendingKeys.has(k))
  retryKeys.push(...(await submit(fresh, false)))
  if (retryKeys.length > 0) await submit(retryKeys, true)

  writeJson(join(ctx.paths.work, 'enrich-summary.json'), {
    selected: selectedKeys.length,
    enriched: stats.enriched,
    errors: stats.errors,
    predictions: stats.predictions,
    tokens: { input: stats.input, cacheRead: stats.cacheRead, cacheCreate: stats.cacheCreate, output: stats.output },
    estCostUsd: Number(
      (
        (stats.input + stats.cacheCreate) * RATE_INPUT +
        stats.cacheRead * RATE_CACHE_READ +
        stats.output * RATE_OUTPUT
      ).toFixed(4),
    ),
  })
  ctx.log(
    `enriched ${stats.enriched} threads (${stats.errors} errors) · ${stats.input} in / ${stats.cacheRead} cache-read / ${stats.output} out tokens`,
  )
}

function emptySummary() {
  return {
    selected: 0,
    enriched: 0,
    errors: 0,
    predictions: { came_true: 0, did_not: 0, unknown: 0 },
    tokens: { input: 0, cacheRead: 0, cacheCreate: 0, output: 0 },
    estCostUsd: 0,
  }
}
