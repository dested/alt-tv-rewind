// Claude wiring shared by the enrich (Haiku, Message Batches) and recap
// (Opus 5) stages: client construction, the enrich output contract, the cached
// system/user prompt builders, and a live probe that picks a structured-output
// mode the installed model actually accepts.
import Anthropic from '@anthropic-ai/sdk'
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
// zodOutputFormat is typed against zod v4; author the schema there so it and the
// helper agree. Project code elsewhere uses the classic `zod` export.
import { z } from 'zod/v4'
import type { EpisodeRecord, ShowMeta } from './types'
import type { ThreadInput } from './thread-text'

export function createClaudeClient(): Anthropic {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY is not set — required by the enrich and recap stages')
  }
  return new Anthropic()
}

export const EnrichOutput = z.object({
  summary: z.string().max(200),
  predictionClaim: z.string().max(200).nullable(),
  predictionOutcome: z.enum(['came_true', 'did_not', 'unknown']).nullable(),
})
export type EnrichOutputData = z.infer<typeof EnrichOutput>

export const ENRICH_TOOL_NAME = 'enrich_thread'

// Fallback path when a model rejects output_config. The parsed input is still
// re-validated through EnrichOutput, so this schema only steers generation.
export const ENRICH_TOOL: Anthropic.Tool = {
  name: ENRICH_TOOL_NAME,
  description: 'Record the one-sentence summary and any prediction grading for this thread.',
  strict: true,
  input_schema: {
    type: 'object',
    properties: {
      summary: { type: 'string', maxLength: 200 },
      predictionClaim: { anyOf: [{ type: 'string', maxLength: 200 }, { type: 'null' }] },
      predictionOutcome: {
        anyOf: [{ type: 'string', enum: ['came_true', 'did_not', 'unknown'] }, { type: 'null' }],
      },
    },
    required: ['summary', 'predictionClaim', 'predictionOutcome'],
    additionalProperties: false,
  },
}

const ENRICH_RULES = [
  'Return only the JSON object.',
  'summary: one sentence ≤ 200 chars, present tense, what the thread discusses and the prevailing take; no poster names, no quotes, no "this thread".',
  'If the thread is a prediction: predictionClaim states the prediction in ≤ 200 chars as a claim about the show; predictionOutcome judges it from your knowledge of what actually happened on the show — came_true, did_not, or unknown when it cannot be judged or is too vague. Otherwise both are null.',
].join('\n')

export function buildEnrichSystem(show: ShowMeta & { newsgroup: string }, episodes: EpisodeRecord[]): string {
  const list = episodes
    .map((ep) => {
      const summary = ep.summary ? ' · ' + ep.summary.slice(0, 120) : ''
      return `${ep.key} · ${ep.title} · ${ep.airDate}${summary}`
    })
    .join('\n')
  return [
    `You summarize Usenet threads from ${show.newsgroup}, the newsgroup for the TV show ${show.name}, for an archive that shows what fans said the morning after each episode aired.`,
    '',
    ENRICH_RULES,
    '',
    `Episodes of ${show.name}:`,
    list,
  ].join('\n')
}

export function buildEnrichUser(
  input: ThreadInput,
  meta: {
    kind: string
    sentiment: string
    episode: { key: string; title: string; airDate: string } | null
    hoursAfterAir: number | null
    // The thread's start (or the episode's air time) had no clock, so timing is
    // stated in whole days rather than hours.
    dateOnly: boolean
  },
): string {
  const parts: string[] = []
  parts.push(`Subject: ${input.subject}`)
  parts.push(`Kind: ${meta.kind} · Sentiment: ${meta.sentiment}`)
  if (meta.episode) {
    let timing = ''
    if (meta.hoursAfterAir !== null) {
      timing = meta.dateOnly
        ? ` (posted ${Math.round(meta.hoursAfterAir / 24)} days after the episode aired)`
        : ` (started ${meta.hoursAfterAir}h after it aired)`
    }
    parts.push(`Attributed episode: ${meta.episode.key} "${meta.episode.title}", aired ${meta.episode.airDate}${timing}`)
  }
  parts.push(`Replies in thread: ${Math.max(0, input.messageCount - 1)}`)
  if (input.opener) {
    parts.push('', 'Opening post:', input.opener.text)
  }
  if (input.replies.length > 0) {
    parts.push('', 'Early replies:')
    for (const r of input.replies) {
      const gap = input.opener?.dateOnly || r.dateOnly ? `+${r.daysLater}d` : `+${r.hoursLater}h`
      parts.push(`[${gap}] ${r.text}`)
    }
  }
  return parts.join('\n')
}

// One tiny live call to see whether this account/model accepts output_config
// structured outputs; a 400 that names output_config/format means fall back to
// a strict tool. Any other failure is a real error and rethrown.
export async function probeStructuredOutputs(client: Anthropic): Promise<'output_config' | 'strict_tool'> {
  try {
    await client.messages.parse({
      model: 'claude-haiku-4-5',
      max_tokens: 128,
      messages: [
        {
          role: 'user',
          content: 'Reply with summary set to "probe", predictionClaim null, and predictionOutcome null.',
        },
      ],
      output_config: { format: zodOutputFormat(EnrichOutput) },
    })
    return 'output_config'
  } catch (e) {
    if (e instanceof Anthropic.BadRequestError && /output_config|format/i.test(e.message)) {
      return 'strict_tool'
    }
    throw e
  }
}
