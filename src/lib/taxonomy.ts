import type { PredictionOutcome, Sentiment, ThreadKind } from '@prisma/client'
import type { BadgeVariant } from '~/components/badge'

// Emoji are allowed in the UI only as these category glyphs (see ui.md).
export const KIND: Record<ThreadKind, { glyph: string; label: string }> = {
  reaction: { glyph: '💬', label: 'Reaction' },
  prediction: { glyph: '🤯', label: 'Prediction' },
  theory: { glyph: '🧠', label: 'Theory' },
  question: { glyph: '❓', label: 'Question' },
  trivia: { glyph: '🧩', label: 'Trivia' },
  quote: { glyph: '🗣️', label: 'Quotes' },
  news: { glyph: '📰', label: 'News' },
  meta: { glyph: '📌', label: 'Newsgroup' },
  offtopic: { glyph: '🌀', label: 'Off topic' },
  spam: { glyph: '🗑️', label: 'Spam' },
}

export const SENTIMENT: Record<Sentiment, { glyph: string; label: string; variant: BadgeVariant }> = {
  loved: { glyph: '😂', label: 'Loved it', variant: 'brand' },
  liked: { glyph: '🙂', label: 'Liked it', variant: 'neutral' },
  mixed: { glyph: '😐', label: 'Mixed', variant: 'neutral' },
  disliked: { glyph: '🙁', label: 'Disliked it', variant: 'neutral' },
  hated: { glyph: '😡', label: 'Hated it', variant: 'bad' },
  neutral: { glyph: '', label: 'Neutral', variant: 'outline' },
}

export const PREDICTION_OUTCOME: Record<PredictionOutcome, { glyph: string; label: string; variant: BadgeVariant }> = {
  came_true: { glyph: '✅', label: 'Came true', variant: 'brand' },
  did_not: { glyph: '❌', label: 'Never happened', variant: 'bad' },
  unknown: { glyph: '❓', label: 'Unresolved', variant: 'outline' },
}

export type EpisodeFilter =
  | 'all'
  | 'controversial'
  | 'loved'
  | 'hated'
  | 'predictions'
  | 'theories'
  | 'questions'

export const EPISODE_FILTERS: ReadonlyArray<{ key: EpisodeFilter; glyph: string; label: string }> = [
  { key: 'all', glyph: '', label: 'All' },
  { key: 'controversial', glyph: '🔥', label: 'Controversial' },
  { key: 'loved', glyph: '😂', label: 'Loved it' },
  { key: 'hated', glyph: '😡', label: 'Hated it' },
  { key: 'predictions', glyph: '🤯', label: 'Predictions' },
  { key: 'theories', glyph: '🧠', label: 'Theories' },
  { key: 'questions', glyph: '❓', label: 'Questions' },
]

export function isEpisodeFilter(value: string | null): value is EpisodeFilter {
  return EPISODE_FILTERS.some((f) => f.key === value)
}
