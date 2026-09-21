import { describe, expect, test } from 'bun:test'
import type { ChoiceResponse, NoulResponse } from '@typesafe-ai/sdk'
import { buildState, toClassification } from './jev'
import type { ThreadInput } from './thread-text'

function choice(selected: string, probabilities: Record<string, number>): ChoiceResponse {
  return { type: 'choice', choice: selected, confidence: probabilities[selected] ?? 0, probabilities }
}
function noul(value: number): NoulResponse {
  return { type: 'noul', noul: value }
}

type Answers = Record<string, ChoiceResponse | NoulResponse>

function baseAnswers(over: Answers = {}): Answers {
  return {
    episode: choice('none', { none: 1 }),
    kind: choice('reaction', { reaction: 0.9, question: 0.1 }),
    sentiment: choice('neutral', { neutral: 0.8, liked: 0.2 }),
    hot_take: noul(0.1),
    spam: noul(0.05),
    ...over,
  }
}

const input: ThreadInput = {
  threadKey: 't1',
  subject: 'The Finale',
  startedAt: '1996-05-16T20:00:00.000Z',
  startedDateOnly: false,
  messageCount: 3,
  opener: { messageId: '<o>', text: 'opener', dateOnly: false },
  replies: [],
  candidateLines: [{ label: 'L1', messageId: '<o>', text: 'A genuinely quotable line about the finale.' }],
}

describe('toClassification', () => {
  test('none maps to a null episode and keeps the confidence of the chosen option', () => {
    const c = toClassification(baseAnswers({ episode: choice('none', { none: 0.4, S07E24: 0.3 }) }), input)
    expect(c.episode).toBeNull()
    expect(c.episodeConfidence).toBe(40)
  })

  test('secondary episodes: threshold 0.15, sorted desc, capped at 3, excluding none and the pick', () => {
    const c = toClassification(
      baseAnswers({
        episode: choice('S07E24', {
          none: 0.05,
          S07E24: 0.4,
          S07E23: 0.2,
          S07E22: 0.16,
          S07E21: 0.18,
          S07E20: 0.1,
        }),
      }),
      input,
    )
    expect(c.episode).toBe('S07E24')
    expect(c.secondaryEpisodes).toEqual(['S07E23', 'S07E21', 'S07E22'])
  })

  test('probabilities are rounded to a percent', () => {
    const c = toClassification(baseAnswers({ episode: choice('S07E24', { S07E24: 0.876, none: 0.124 }) }), input)
    expect(c.episodeConfidence).toBe(88)
  })

  test('hotTake trips at 60', () => {
    expect(toClassification(baseAnswers({ hot_take: noul(0.6) }), input).hotTake).toBe(true)
    expect(toClassification(baseAnswers({ hot_take: noul(0.6) }), input).hotTakeProbability).toBe(60)
    expect(toClassification(baseAnswers({ hot_take: noul(0.59) }), input).hotTake).toBe(false)
  })

  test('spam probability is a rounded percent', () => {
    expect(toClassification(baseAnswers({ spam: noul(0.912) }), input).spamProbability).toBe(91)
  })

  test('pull quote below 0.3 is dropped', () => {
    const c = toClassification(baseAnswers({ pull_quote: choice('L1', { L1: 0.2, none: 0.8 }) }), input)
    expect(c.pullQuote).toBeNull()
    expect(c.pullQuoteMessageId).toBeNull()
  })

  test('pull quote at or above 0.3 resolves to the candidate text and message id', () => {
    const c = toClassification(baseAnswers({ pull_quote: choice('L1', { L1: 0.5, none: 0.5 }) }), input)
    expect(c.pullQuote).toBe('A genuinely quotable line about the finale.')
    expect(c.pullQuoteMessageId).toBe('<o>')
  })

  test('pull quote of none is dropped', () => {
    const c = toClassification(baseAnswers({ pull_quote: choice('none', { none: 0.9, L1: 0.1 }) }), input)
    expect(c.pullQuote).toBeNull()
  })

  test('prose fields are left null for the enrich stage', () => {
    const c = toClassification(baseAnswers(), input)
    expect(c.summary).toBeNull()
    expect(c.predictionClaim).toBeNull()
    expect(c.predictionOutcome).toBeNull()
  })
})

describe('buildState', () => {
  const stateCtx = { showName: 'Seinfeld', newsgroup: 'alt.tv.seinfeld', hints: [] as string[] }

  test('a timed opener gets a clock and hours_later replies', () => {
    const timed: ThreadInput = {
      ...input,
      startedDateOnly: false,
      opener: { messageId: '<o>', text: 'opener', dateOnly: false },
      replies: [{ messageId: '<r>', hoursLater: 3.5, daysLater: 0, dateOnly: false, text: 'reply' }],
    }
    const state = buildState(timed, stateCtx)
    expect(String(state.thread_started)).toMatch(/ ET$/)
    expect(state.replies).toEqual([{ hours_later: 3.5, text: 'reply' }])
    // omitted fields are absent, not null
    expect('timing_hints' in state).toBe(false)
  })

  test('a date-only opener drops the clock and reports replies in days', () => {
    const dateOnly: ThreadInput = {
      ...input,
      startedAt: '1996-05-17T12:00:00.000Z',
      startedDateOnly: true,
      opener: { messageId: '<o>', text: 'opener', dateOnly: true },
      replies: [{ messageId: '<r>', hoursLater: 48, daysLater: 2, dateOnly: true, text: 'reply' }],
    }
    const state = buildState(dateOnly, stateCtx)
    expect(state.thread_started).toBe('Friday, May 17, 1996')
    expect(state.replies).toEqual([{ days_later: 2, text: 'reply' }])
  })
})
