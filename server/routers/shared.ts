// Shared building blocks for the product API routers: the ThreadCard /
// EpisodeCard select objects + mappers, the archive summary shape, common zod
// inputs, and date-serialization helpers. Everything here returns JSON-safe
// values (ISO strings on the wire) so SSR markup and post-hydration render match.

import { z } from 'zod'
import { Prisma } from '@prisma/client'
import type {
  ThreadKind,
  Sentiment,
  PredictionOutcome,
  EpisodeRelation,
  SourceKind,
  OriginalStatus,
  DatePrecision,
} from '@prisma/client'
import { prisma } from '../prisma'

// ───────────────────────── date helpers ─────────────────────────

export const iso = (d: Date): string => d.toISOString()
export const isoOrNull = (d: Date | null): string | null => (d === null ? null : d.toISOString())
export const isoDate = (d: Date): string => d.toISOString().slice(0, 10)
export const isoDateOrNull = (d: Date | null): string | null =>
  d === null ? null : d.toISOString().slice(0, 10)
export const isoMonth = (d: Date): string => d.toISOString().slice(0, 7)

// ───────────────────────── shared zod inputs ─────────────────────────

export const slugInput = z.object({ slug: z.string().min(1) })
export const relationInput = z.enum(['live', 'retro'])

// ───────────────────────── output types ─────────────────────────

export type ArchiveSummary = {
  newsgroup: string
  messageCount: number
  threadCount: number
  firstPostAt: string | null
  lastPostAt: string | null
}

export type EpisodeCard = {
  id: number
  slug: string
  seasonNumber: number
  number: number
  title: string
  airDate: string
  imageUrl: string | null
  liveThreadCount: number
  liveMessageCount: number
  retroThreadCount: number
  retroMessageCount: number
  usenetScore: number | null
  tvmazeRating: number | null
}

export type ThreadCard = {
  id: number
  slug: string // stable URL identity (survives reloads; ids do not)
  subject: string
  startedAt: string
  startedDateOnly: boolean // the opener's header had no time of day
  lastPostAt: string
  messageCount: number
  posterCount: number
  maxDepth: number
  kind: ThreadKind | null
  sentiment: Sentiment | null
  hotTake: boolean | null
  controversy: number
  summary: string | null
  pullQuote: string | null
  predictionClaim: string | null
  predictionOutcome: PredictionOutcome | null
  starter: { id: number; displayName: string } | null
  episode: {
    slug: string
    title: string
    seasonNumber: number
    number: number
    relation: 'live' | 'retro'
    confidence: number
  } | null
  hoursAfterAir: number | null // null unless the opener's hour is real and the episode has an airStamp
  daysAfterAir: number | null // calendar days (network zone) between air date and the opener
  source: SourceRef | null // the community this thread was archived from
}

// 'YYYY-MM-DD' of an instant in the network's zone (en-CA renders ISO order).
const etDate = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/New_York',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

export function daysBetweenAirAndPost(airDate: Date, postedAt: Date): number {
  const postedDay = Date.parse(`${etDate.format(postedAt)}T00:00:00Z`)
  return Math.round((postedDay - airDate.getTime()) / 86_400_000)
}

// ───────────────────────── source location ─────────────────────────

// A community: newsgroup, forum, or capsule compilation. The reader-facing
// reference (name + kind) that every post, thread and listing carries.
export type SourceRef = { key: string; name: string; kind: SourceKind }

// Everywhere a post can be found: our own preserved view, the live original, an
// archived replay, the custodian's collection. Nulls mean "not available", so
// the UI shows only the links that exist.
export type SourceLocation = {
  source: SourceRef
  browseUrl: string | null // source.homeUrl → "Browse source"
  originalUrl: string | null // exact permalink → "Original post" / "Original document"
  originalStatus: OriginalStatus // is the original permalink reachable today
  archivedUrl: string | null // exact replay → "Archived copy"
  collectionUrl: string | null // custodian listing → "Archive collection"
  preservedPath: string | null // "/sources/<key>/records/<recordId>" → "Preserved record"
  captureCount: number
  capturedAt: string | null // earliest capture, ISO
}

// Per-post timing against the thread's primary episode. Shown when it disagrees
// with the thread's relation (a later reply inside a premiere thread, say), so
// no post is mislabeled a live reaction. `unknown` = the header carried no date.
export type PostTiming = 'before' | 'live' | 'later' | 'unknown'

export const sourceRefSelect = {
  key: true,
  name: true,
  kind: true,
} satisfies Prisma.SourceSelect

// The source fields needed to build a SourceLocation (superset of sourceRefSelect).
export const sourceLocationSourceSelect = {
  key: true,
  name: true,
  kind: true,
  publication: true,
  homeUrl: true,
  collectionUrl: true,
  originalStatus: true,
} satisfies Prisma.SourceSelect

type SourceLocationSource = Prisma.SourceGetPayload<{ select: typeof sourceLocationSourceSelect }>
type LocationRecord = { recordId: string; externalId: string; originalUrl: string | null }
type LocationObservation = { capturedAt: Date | null; capturedPageUrl: string | null }

// Wayback path stamp (YYYYMMDDhhmmss, UTC) for a capture instant.
export function waybackStamp(d: Date): string {
  const s = d.toISOString()
  return (
    s.slice(0, 4) + s.slice(5, 7) + s.slice(8, 10) + s.slice(11, 13) + s.slice(14, 16) + s.slice(17, 19)
  )
}

// Builds a post's SourceLocation. `record` is null for legacy posts (their
// source is the archive's source, they have no per-post permalink); forum posts
// pass their record and observations so an Archived copy (Wayback replay of the
// earliest captured page) can be linked. captureCount counts every observation.
export function sourceLocationFor(
  source: SourceLocationSource,
  record: LocationRecord | null,
  observations: LocationObservation[]
): SourceLocation {
  let capturedAt: Date | null = null
  for (const o of observations) {
    if (o.capturedAt && (capturedAt === null || o.capturedAt.getTime() < capturedAt.getTime())) {
      capturedAt = o.capturedAt
    }
  }

  let archivedUrl: string | null = null
  if (source.kind === 'forum' && record !== null) {
    let best: { at: Date; page: string } | null = null
    for (const o of observations) {
      if (o.capturedAt && o.capturedPageUrl) {
        if (best === null || o.capturedAt.getTime() < best.at.getTime()) {
          best = { at: o.capturedAt, page: o.capturedPageUrl }
        }
      }
    }
    if (best) {
      archivedUrl = `https://web.archive.org/web/${waybackStamp(best.at)}/${best.page}#p${record.externalId}`
    }
  }

  return {
    source: { key: source.key, name: source.name, kind: source.kind },
    browseUrl: source.homeUrl,
    originalUrl: record?.originalUrl ?? null,
    originalStatus: source.originalStatus,
    archivedUrl,
    collectionUrl: source.collectionUrl,
    preservedPath:
      source.publication === 'public' && record !== null
        ? `/sources/${source.key}/records/${record.recordId}`
        : null,
    captureCount: observations.length,
    capturedAt: capturedAt === null ? null : capturedAt.toISOString(),
  }
}

// Mirror of pipeline/lib/timing.ts postTiming, on ET calendar days (do not
// import across the server/pipeline boundary — CLAUDE.md hard rule #2). `unknown`
// precision means postedAt was inherited and is a sort key, not an observed time.
export function postTimingFor(
  airDate: Date,
  postedAt: Date,
  liveWindowDays: number,
  datePrecision: DatePrecision | null
): PostTiming {
  if (datePrecision === 'unknown') return 'unknown'
  const days = daysBetweenAirAndPost(airDate, postedAt)
  if (days < -1) return 'before'
  if (days <= liveWindowDays) return 'live'
  return 'later'
}

// ───────────────────────── archive summary ─────────────────────────

export const archiveSelect = {
  newsgroup: true,
  messageCount: true,
  threadCount: true,
  firstPostAt: true,
  lastPostAt: true,
} satisfies Prisma.ArchiveSelect

type ArchiveRow = Prisma.ArchiveGetPayload<{ select: typeof archiveSelect }>

export function toArchiveSummary(a: ArchiveRow): ArchiveSummary {
  return {
    newsgroup: a.newsgroup,
    messageCount: a.messageCount,
    threadCount: a.threadCount,
    firstPostAt: isoOrNull(a.firstPostAt),
    lastPostAt: isoOrNull(a.lastPostAt),
  }
}

// ───────────────────────── episode card ─────────────────────────

export const episodeCardSelect = {
  id: true,
  slug: true,
  seasonNumber: true,
  number: true,
  title: true,
  airDate: true,
  imageUrl: true,
  liveThreadCount: true,
  liveMessageCount: true,
  retroThreadCount: true,
  retroMessageCount: true,
  usenetScore: true,
  tvmazeRating: true,
} satisfies Prisma.EpisodeSelect

export type EpisodeCardRow = Prisma.EpisodeGetPayload<{ select: typeof episodeCardSelect }>

export function toEpisodeCard(e: EpisodeCardRow): EpisodeCard {
  return {
    id: e.id,
    slug: e.slug,
    seasonNumber: e.seasonNumber,
    number: e.number,
    title: e.title,
    airDate: isoDate(e.airDate),
    imageUrl: e.imageUrl,
    liveThreadCount: e.liveThreadCount,
    liveMessageCount: e.liveMessageCount,
    retroThreadCount: e.retroThreadCount,
    retroMessageCount: e.retroMessageCount,
    usenetScore: e.usenetScore,
    tvmazeRating: e.tvmazeRating,
  }
}

// ───────────────────────── thread card ─────────────────────────

// One select reused everywhere a ThreadCard is produced. The primary
// thread_episode (and its episode's airStamp, used only to derive
// hoursAfterAir) rides along; the starter is resolved by mapThreadCards via a
// single batched lookup on rootMessageId (no relation exists for it).
export const threadCardSelect = {
  id: true,
  slug: true,
  subject: true,
  startedAt: true,
  startedDateOnly: true,
  lastPostAt: true,
  messageCount: true,
  posterCount: true,
  maxDepth: true,
  kind: true,
  sentiment: true,
  hotTake: true,
  controversy: true,
  summary: true,
  pullQuote: true,
  predictionClaim: true,
  predictionOutcome: true,
  rootMessageId: true,
  archive: { select: { source: { select: sourceRefSelect } } },
  episodes: {
    where: { isPrimary: true },
    select: {
      relation: true,
      confidence: true,
      episode: {
        select: {
          slug: true,
          title: true,
          seasonNumber: true,
          number: true,
          airStamp: true,
          airDate: true,
        },
      },
    },
  },
} satisfies Prisma.ThreadSelect

export type ThreadCardRow = Prisma.ThreadGetPayload<{ select: typeof threadCardSelect }>

type Starter = { id: number; displayName: string } | null

function toThreadCard(r: ThreadCardRow, starter: Starter): ThreadCard {
  const primary = r.episodes[0] ?? null
  const episode = primary
    ? {
        slug: primary.episode.slug,
        title: primary.episode.title,
        seasonNumber: primary.episode.seasonNumber,
        number: primary.episode.number,
        relation: primary.relation,
        confidence: primary.confidence,
      }
    : null
  const airStamp = primary?.episode.airStamp ?? null
  const hoursAfterAir =
    airStamp === null || r.startedDateOnly
      ? null
      : Math.round(((r.startedAt.getTime() - airStamp.getTime()) / 3_600_000) * 10) / 10
  const daysAfterAir = primary ? daysBetweenAirAndPost(primary.episode.airDate, r.startedAt) : null
  const src = r.archive.source
  return {
    id: r.id,
    slug: r.slug,
    subject: r.subject,
    startedAt: iso(r.startedAt),
    startedDateOnly: r.startedDateOnly,
    lastPostAt: iso(r.lastPostAt),
    messageCount: r.messageCount,
    posterCount: r.posterCount,
    maxDepth: r.maxDepth,
    kind: r.kind,
    sentiment: r.sentiment,
    hotTake: r.hotTake,
    controversy: r.controversy,
    summary: r.summary,
    pullQuote: r.pullQuote,
    predictionClaim: r.predictionClaim,
    predictionOutcome: r.predictionOutcome,
    starter,
    episode,
    hoursAfterAir,
    daysAfterAir,
    source: src ? { key: src.key, name: src.name, kind: src.kind } : null,
  }
}

// Maps a page of thread rows to ThreadCards, resolving each thread's starter
// (poster of its root message) in one batched query. Preserves input order.
export async function mapThreadCards(rows: ThreadCardRow[]): Promise<ThreadCard[]> {
  const rootIds = rows.flatMap((r) => (r.rootMessageId === null ? [] : [r.rootMessageId]))
  const starters = rootIds.length
    ? await prisma.message.findMany({
        where: { id: { in: rootIds } },
        select: { id: true, poster: { select: { id: true, displayName: true } } },
      })
    : []
  const starterByMessageId = new Map(starters.map((m) => [m.id, m.poster]))
  return rows.map((r) =>
    toThreadCard(r, r.rootMessageId === null ? null : starterByMessageId.get(r.rootMessageId) ?? null)
  )
}
