// Jev ("System One") wiring for the classify stage: builds the typed question
// set and state payload for one thread, and folds the calibrated answers back
// into a Classification. Jev cannot generate text and reads its instructions
// literally, so every criterion is a plain declarative description.
import { choice, noul, TypeSafeClient } from '@typesafe-ai/sdk'
import type { ChoiceResponse, JsonValue, NoulResponse, Questions, ScoreResponse } from '@typesafe-ai/sdk'
import { Classification } from './types'
import type { EpisodeRecord } from './types'
import type { ThreadInput } from './thread-text'

export function createJevClient(): TypeSafeClient {
  if (!process.env.TYPESAFE_API_KEY) {
    throw new Error('TYPESAFE_API_KEY is not set — required by the classify stage')
  }
  return new TypeSafeClient({ timeout: 30_000 })
}

export function buildQuestions(episodes: EpisodeRecord[], candidateLines: ThreadInput['candidateLines']): Questions {
  const episodeCriteria: Record<string, string> = { none: 'Not primarily about one specific episode' }
  for (const ep of episodes) {
    const summary = ep.summary ? ' — ' + ep.summary.slice(0, 90) : ''
    episodeCriteria[ep.key] = `${ep.title} — first aired ${ep.airDate}${summary}`
  }

  const questions: Questions = {
    episode: choice(
      'Which episode is this thread primarily about? Pick none when the thread is about the show in general, about several episodes, or about something else. A thread started within a few days after an air date that reacts to last night’s episode without naming it is about that episode.',
      episodeCriteria,
    ),
    kind: choice('What kind of thread is this, judging by the opening post?', {
      reaction: 'Opinions about an episode or the show — what worked, what did not',
      prediction: 'Guesses about what will happen in future episodes or to the show',
      theory: 'An explanation of a plot point, continuity detail, or hidden meaning',
      question: 'Asks for facts, identification of an episode, or help remembering something',
      trivia: 'Shares facts about cast, production, references, or things noticed',
      quote: 'Posts or collects lines and dialogue from the show',
      news: 'Ratings, scheduling, press coverage, cast or network news',
      meta: 'About the newsgroup itself — FAQ, netiquette, posting rules',
      offtopic: 'Not about the show',
      spam: 'Advertising, adult content, scams, or chain letters',
    }),
    sentiment: choice('How does the opening poster feel about the episode or show being discussed?', {
      loved: 'Enthusiastic praise',
      liked: 'Positive overall',
      mixed: 'Both praise and complaints',
      disliked: 'Negative overall',
      hated: 'Strong dislike or anger',
      neutral: 'No opinion expressed — a question, fact, or announcement',
    }),
    hot_take: noul('The opening post takes a strong, provocative stance that other fans are likely to argue with', {
      true: 'A bold or contrarian opinion stated forcefully',
      false: 'Mild, balanced, factual, or a question',
    }),
    spam: noul('The opening post is unsolicited junk rather than a genuine post to this newsgroup', {
      true: 'Advertising, adult content, get-rich schemes, chain letters, or unrelated mass posting',
      false: 'A real message from a participant, even if off topic',
    }),
  }

  if (candidateLines.length > 0) {
    const pullCriteria: Record<string, string> = { none: 'Nothing here stands out' }
    for (const c of candidateLines) pullCriteria[c.label] = c.text
    questions.pull_quote = choice('Which line is the most striking, funny, or quotable, read on its own?', pullCriteria)
  }

  return questions
}

// "Thursday, May 16, 1996 11:41 PM ET" — split date and time formatters so the
// output reads exactly this way rather than Intl's "... at 11:41 PM".
function formatStarted(iso: string): string {
  const d = new Date(iso)
  const date = new Intl.DateTimeFormat('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'America/New_York',
  }).format(d)
  const time = new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone: 'America/New_York',
  }).format(d)
  return `${date} ${time} ET`
}

export function buildState(
  input: ThreadInput,
  ctx: { showName: string; newsgroup: string; hints: string[] },
): JsonValue {
  const state: Record<string, JsonValue> = {
    newsgroup: ctx.newsgroup,
    show: ctx.showName,
    thread_started: formatStarted(input.startedAt),
  }
  if (ctx.hints.length > 0) state.timing_hints = ctx.hints
  state.subject = input.subject
  if (input.opener) state.opening_post = input.opener.text
  if (input.replies.length > 0) {
    state.replies = input.replies.map((r) => ({ hours_later: r.hoursLater, text: r.text }))
  }
  state.total_replies = input.messageCount - 1
  if (input.candidateLines.length > 0) {
    const lines: Record<string, string> = {}
    for (const c of input.candidateLines) lines[c.label] = c.text
    state.candidate_lines = lines
  }
  return state
}

type AnyAnswer = ChoiceResponse | NoulResponse | ScoreResponse
type Answers = Readonly<Record<string, AnyAnswer>>

function requireChoice(answers: Answers, key: string): ChoiceResponse {
  const a = answers[key]
  if (!a || a.type !== 'choice') throw new Error(`classify: expected a choice answer for "${key}"`)
  return a
}

function requireNoul(answers: Answers, key: string): NoulResponse {
  const a = answers[key]
  if (!a || a.type !== 'noul') throw new Error(`classify: expected a noul answer for "${key}"`)
  return a
}

const asPct = (p: number): number => Math.round(p * 100)

export function toClassification(answers: Answers, input: ThreadInput): Classification {
  const episode = requireChoice(answers, 'episode')
  const kind = requireChoice(answers, 'kind')
  const sentiment = requireChoice(answers, 'sentiment')
  const hotTake = requireNoul(answers, 'hot_take')
  const spam = requireNoul(answers, 'spam')

  const secondaryEpisodes = Object.entries(episode.probabilities)
    .filter(([key, p]) => key !== 'none' && key !== episode.choice && p >= 0.15)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([key]) => key)

  let pullQuote: string | null = null
  let pullQuoteMessageId: string | null = null
  const pull = answers.pull_quote
  if (pull && pull.type === 'choice' && pull.choice !== 'none') {
    const p = pull.probabilities[pull.choice] ?? 0
    if (p >= 0.3) {
      const candidate = input.candidateLines.find((c) => c.label === pull.choice)
      if (candidate) {
        pullQuote = candidate.text
        pullQuoteMessageId = candidate.messageId
      }
    }
  }

  const hotTakeProbability = asPct(hotTake.noul)

  // Parse folds the model's stringly-typed choices through the ThreadKind /
  // Sentiment enums — an unexpected label throws instead of leaking downstream.
  return Classification.parse({
    episode: episode.choice === 'none' ? null : episode.choice,
    episodeConfidence: asPct(episode.probabilities[episode.choice] ?? 0),
    secondaryEpisodes,
    kind: kind.choice,
    kindConfidence: asPct(kind.probabilities[kind.choice] ?? 0),
    sentiment: sentiment.choice,
    sentimentConfidence: asPct(sentiment.probabilities[sentiment.choice] ?? 0),
    hotTake: hotTakeProbability >= 60,
    hotTakeProbability,
    spamProbability: asPct(spam.noul),
    summary: null,
    pullQuote,
    pullQuoteMessageId,
    predictionClaim: null,
    predictionOutcome: null,
  })
}
