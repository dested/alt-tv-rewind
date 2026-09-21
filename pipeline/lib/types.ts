// Contracts between pipeline stages. Every checkpoint file under
// data/work/<slug>/ is JSONL of one of these records; every config file under
// data/ is one of these documents. Parse with the zod schema on read — never
// trust a checkpoint written by an older run.
import { z } from 'zod'

// ───────────────────────── config (committed under data/) ─────────────────────────

// data/shows.json — the registry. One entry per show; `bun run pipeline add-show`
// appends here.
export const ShowConfig = z.object({
  slug: z.string().regex(/^[a-z0-9-]+$/), // "seinfeld" — URL segment
  name: z.string(), // "Seinfeld"
  newsgroup: z.string(), // "alt.tv.seinfeld" — archive.org usenet-alt item name
  tvmazeQuery: z.string(), // singlesearch query; pinned by tvmazeId once resolved
  tvmazeId: z.number().int().optional(),
  // A thread started within this many days after an air date is "live" for it.
  liveWindowDays: z.number().int().default(10),
})
export type ShowConfig = z.infer<typeof ShowConfig>
export const ShowRegistry = z.array(ShowConfig)

// data/shows/<slug>/episodes.json — normalized TVMaze snapshot (stage: episodes)
export const EpisodeRecord = z.object({
  key: z.string(), // "S07E24"
  slug: z.string(), // "s07e24-the-invitations"
  season: z.number().int(),
  number: z.number().int(),
  title: z.string(),
  airDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  airStamp: z.string().nullable(), // ISO 8601 with offset, from TVMaze
  runtime: z.number().int().nullable(),
  summary: z.string().nullable(), // HTML stripped to plain text
  imageUrl: z.string().nullable(), // TVMaze image.original
  tvmazeId: z.number().int(),
  rating: z.number().nullable(), // TVMaze rating.average
})
export type EpisodeRecord = z.infer<typeof EpisodeRecord>

export const ShowMeta = z.object({
  tvmazeId: z.number().int(),
  name: z.string(),
  premiered: z.string().nullable(),
  ended: z.string().nullable(),
  network: z.string().nullable(),
  summary: z.string().nullable(),
  imageUrl: z.string().nullable(),
})
export type ShowMeta = z.infer<typeof ShowMeta>

export const EpisodesFile = z.object({
  fetchedAt: z.string(),
  show: ShowMeta,
  episodes: z.array(EpisodeRecord),
})
export type EpisodesFile = z.infer<typeof EpisodesFile>

// data/shows/<slug>/aliases.json — { "<episode title>": ["soup nazi", ...] }.
// Keyed by title (stable across sources); "(1)"/"Part 1" suffixes are stripped
// when resolving, so a two-parter's aliases attach to both parts.
export const AliasesFile = z.record(z.string(), z.array(z.string()))
export type AliasesFile = z.infer<typeof AliasesFile>

// data/shows/<slug>/phrases.json — curated catchphrases (stage: stats)
export const PhraseConfig = z.object({
  slug: z.string().regex(/^[a-z0-9-]+$/),
  label: z.string(),
  pattern: z.string(), // regex source, compiled with flags "i"
  episode: z.string().optional(), // episode title that coined it
})
export type PhraseConfig = z.infer<typeof PhraseConfig>
export const PhrasesFile = z.array(PhraseConfig)

// ───────────────────────── checkpoints (data/work/<slug>/, gitignored) ─────────────────────────

// stage parse → messages.jsonl
export const ParsedMessage = z.object({
  messageId: z.string(), // RFC Message-ID incl. angle brackets, e.g. "<abc@host>"
  subject: z.string(),
  subjectNorm: z.string(), // Re:/Fwd: prefixes stripped, whitespace collapsed, lowercased
  fromName: z.string(), // display name only — never the address
  posterKey: z.string().length(16), // sha256 hex prefix of lowercased address, or "n:" + name hash
  postedAt: z.string().nullable(), // ISO 8601 UTC; null when no header date parses
  references: z.array(z.string()), // oldest → newest, as in the References header
  inReplyTo: z.string().nullable(),
  newsgroups: z.array(z.string()),
  body: z.string(), // decoded text, CRLF→LF, capped at 65536 chars
  lineCount: z.number().int(),
  isSpam: z.boolean(),
  spamReason: z.string().nullable(),
})
export type ParsedMessage = z.infer<typeof ParsedMessage>

// stage thread → threaded.jsonl (one per message) + threads.jsonl (one per thread)
export const ThreadedMessage = ParsedMessage.extend({
  threadKey: z.string(), // "t<n>", stable within one run
  parentRef: z.string().nullable(), // Message-ID of the resolved parent (present in archive)
  depth: z.number().int(),
  postedAt: z.string(), // resolved: parent's date, else thread's, else dropped
})
export type ThreadedMessage = z.infer<typeof ThreadedMessage>

export const ThreadRecord = z.object({
  threadKey: z.string(),
  rootMessageId: z.string().nullable(), // null when the root is missing from the archive
  subject: z.string(), // display subject of the earliest message, Re: stripped
  subjectNorm: z.string(),
  startedAt: z.string(),
  lastPostAt: z.string(),
  messageCount: z.number().int(),
  posterCount: z.number().int(),
  maxDepth: z.number().int(),
  isSpam: z.boolean(), // root (or earliest message) is spam
})
export type ThreadRecord = z.infer<typeof ThreadRecord>

// stage attribute → candidates.jsonl (one per thread that has any signal)
export const Candidate = z.object({
  key: z.string(), // "S07E24"
  score: z.number(),
  signals: z.array(z.string()), // e.g. ["window:+1d", "title:subject", "alias:susan dies"]
})
export const CandidateRecord = z.object({
  threadKey: z.string(),
  candidates: z.array(Candidate), // best first, max 6
  inLiveWindow: z.boolean(), // started within liveWindowDays after some air date
})
export type CandidateRecord = z.infer<typeof CandidateRecord>

// stage classify → classified.jsonl (one per LLM-classified thread)
export const ThreadKind = z.enum([
  'reaction',
  'prediction',
  'theory',
  'question',
  'trivia',
  'quote',
  'news',
  'meta',
  'offtopic',
  'spam',
])
export const Sentiment = z.enum(['loved', 'liked', 'mixed', 'disliked', 'hated', 'neutral'])
export const PredictionOutcome = z.enum(['came_true', 'did_not', 'unknown'])

export const Classification = z.object({
  episode: z.string().nullable(), // "S07E24" — the episode this thread is primarily about
  episodeConfidence: z.number().int().min(0).max(100),
  secondaryEpisodes: z.array(z.string()).max(3),
  kind: ThreadKind,
  sentiment: Sentiment,
  hotTake: z.boolean(), // opener is a strong opinion likely to provoke disagreement
  summary: z.string().max(200), // one line, present tense, no poster names
  pullQuote: z.string().max(240).nullable(), // verbatim line from a provided message
  pullQuoteMessageId: z.string().nullable(), // Message-ID the quote came from
  predictionClaim: z.string().max(200).nullable(), // only when kind = prediction
  predictionOutcome: PredictionOutcome.nullable(), // only when kind = prediction
})
export type Classification = z.infer<typeof Classification>

export const ClassifiedRecord = z.object({
  threadKey: z.string(),
  model: z.string(),
  classification: Classification,
  inputTokens: z.number().int(),
  outputTokens: z.number().int(),
})
export type ClassifiedRecord = z.infer<typeof ClassifiedRecord>

// stage recap → recaps.jsonl
export const RecapRecord = z.object({
  episodeKey: z.string(),
  model: z.string(),
  recap: z.string(),
})
export type RecapRecord = z.infer<typeof RecapRecord>

// ───────────────────────── stage plumbing ─────────────────────────

export const STAGES = [
  'parse',
  'thread',
  'episodes',
  'attribute',
  'classify',
  'load',
  'stats',
  'recap',
] as const
export type StageName = (typeof STAGES)[number]

export type StageContext = {
  show: ShowConfig
  paths: {
    archive: string // data/archives/<newsgroup>.mbox
    work: string // data/work/<slug>/
    showDir: string // data/shows/<slug>/
    episodesFile: string
    aliasesFile: string
    phrasesFile: string
  }
  force: boolean // ignore existing checkpoints
  log: (msg: string) => void
}

export type Stage = { name: StageName; run: (ctx: StageContext) => Promise<void> }
