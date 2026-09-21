import { useEffect, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTRPC } from '~/lib/trpc'
import type { RouterOutputs } from '~/lib/api-types'
import { FilterTabs } from '~/components/filter-tabs'
import { ReactionCurve } from '~/components/reaction-curve'
import { StatLine } from '~/components/stat-line'
import { ThreadCard } from '~/components/thread-card'
import { Button } from '~/components/ui/button'
import { isEpisodeFilter, type EpisodeFilter } from '~/lib/taxonomy'
import {
  episodeCode,
  formatAirDate,
  formatDateTime,
  formatMonth,
  formatNumber,
  relativeToAir,
} from '~/lib/format'

type ByEpisode = RouterOutputs['threads']['byEpisode']

export function EpisodePage() {
  const { show, episode } = useParams()
  const trpc = useTRPC()
  const queryClient = useQueryClient()
  const [params, setParams] = useSearchParams()

  const episodeQuery = useQuery(
    trpc.episodes.get.queryOptions(
      { slug: show ?? '', episode: episode ?? '' },
      { enabled: Boolean(show && episode) }
    )
  )

  const tabParam = params.get('tab')
  const tab: EpisodeFilter = isEpisodeFilter(tabParam) ? tabParam : 'all'
  const episodeId = episodeQuery.data?.episode.id

  const liveQuery = useQuery(
    trpc.threads.byEpisode.queryOptions(
      {
        episodeId: episodeId ?? 0,
        relation: 'live',
        filter: tab,
        sort: 'size',
        cursor: 0,
        limit: 20,
      },
      { enabled: episodeId !== undefined }
    )
  )
  const retroQuery = useQuery(
    trpc.threads.byEpisode.queryOptions(
      {
        episodeId: episodeId ?? 0,
        relation: 'retro',
        filter: 'all',
        sort: 'size',
        cursor: 0,
        limit: 20,
      },
      { enabled: episodeId !== undefined }
    )
  )

  const [liveExtra, setLiveExtra] = useState<ByEpisode[]>([])
  const [retroExtra, setRetroExtra] = useState<ByEpisode[]>([])
  const [liveLoading, setLiveLoading] = useState(false)
  const [retroLoading, setRetroLoading] = useState(false)

  // A tab change re-scopes the live list, so its accumulated pages are stale.
  useEffect(() => {
    setLiveExtra([])
  }, [tab])

  const data = episodeQuery.data
  if (!data) return <p className="text-muted-foreground text-sm">Loading…</p>

  const ep = data.episode
  const showSlug = data.show.slug

  const livePages = [liveQuery.data, ...liveExtra]
  const liveItems = livePages.flatMap((p) => p?.items ?? [])
  const liveNext = (liveExtra[liveExtra.length - 1] ?? liveQuery.data)?.nextCursor ?? null

  const retroPages = [retroQuery.data, ...retroExtra]
  const retroItems = retroPages.flatMap((p) => p?.items ?? [])
  const retroNext = (retroExtra[retroExtra.length - 1] ?? retroQuery.data)?.nextCursor ?? null

  async function loadMore(
    relation: 'live' | 'retro',
    cursor: number,
    filter: EpisodeFilter,
    setExtra: (fn: (prev: ByEpisode[]) => ByEpisode[]) => void,
    setLoading: (v: boolean) => void
  ) {
    if (episodeId === undefined) return
    setLoading(true)
    try {
      const page = await queryClient.fetchQuery(
        trpc.threads.byEpisode.queryOptions({
          episodeId,
          relation,
          filter,
          sort: 'size',
          cursor,
          limit: 20,
        })
      )
      setExtra((prev) => [...prev, page])
    } finally {
      setLoading(false)
    }
  }

  const sentimentCount = (s: string): number =>
    data.breakdown.sentiments.find((x) => x.sentiment === s)?.count ?? 0
  const kindCount = (k: string): number =>
    data.breakdown.kinds.find((x) => x.kind === k)?.count ?? 0
  const counts: Partial<Record<EpisodeFilter, number>> = {
    all: ep.liveThreadCount,
    loved: sentimentCount('loved') + sentimentCount('liked'),
    hated: sentimentCount('hated') + sentimentCount('disliked'),
    predictions: kindCount('prediction'),
    theories: kindCount('theory'),
    questions: kindCount('question'),
  }

  const stats: Array<{ value: string; label: string }> = [
    { value: formatNumber(ep.liveThreadCount), label: 'threads' },
    { value: formatNumber(ep.liveMessageCount), label: 'posts' },
    { value: formatNumber(ep.livePosterCount), label: 'posters' },
  ]
  if (ep.usenetScore !== null) {
    stats.push({
      value: `${ep.usenetScore >= 0 ? '+' : ''}${ep.usenetScore.toFixed(1)}`,
      label: 'Usenet score',
    })
  }
  if (ep.tvmazeRating !== null) {
    stats.push({ value: formatNumber(ep.tvmazeRating), label: 'TVMaze today' })
  }

  const preArchive = data.archiveFrom !== null && ep.airDate < data.archiveFrom.slice(0, 10)
  const liveEmpty =
    tab === 'all'
      ? preArchive && data.archiveFrom
        ? `No live reaction survived for this episode — the archive begins in ${formatMonth(data.archiveFrom, 'long')}.`
        : 'No live reaction was captured for this episode.'
      : 'Nothing in this category.'

  return (
    <div className="space-y-10">
      {ep.imageUrl && (
        <img src={ep.imageUrl} alt="" className="aspect-video w-full rounded-xl object-cover" />
      )}

      <div className="space-y-3">
        <div>
          <h1 className="font-serif text-5xl font-semibold tracking-tight text-balance">
            {ep.title}
          </h1>
          <p className="text-muted-foreground text-sm">
            Season {ep.seasonNumber} · Episode {ep.number} · Aired {formatAirDate(ep.airDate)}
          </p>
        </div>

        {ep.recap ? (
          <p className="border-brand max-w-[62ch] border-l-2 pl-4 font-serif text-xl leading-relaxed">
            {ep.recap}
          </p>
        ) : (
          ep.summary && <p className="text-muted-foreground max-w-[62ch]">{ep.summary}</p>
        )}

        <StatLine items={stats} />
      </div>

      {data.reactionByDay.some((p) => p.messages > 0) && (
        <div className="space-y-1">
          <ReactionCurve points={data.reactionByDay} airDate={ep.airDate} />
          <p className="text-muted-foreground text-sm">Posts per day after the first airing</p>
        </div>
      )}

      <section className="space-y-4">
        <h2 className="font-serif text-2xl font-semibold tracking-tight">The morning after</h2>
        <FilterTabs value={tab} counts={counts} onChange={changeTab} />
        {liveItems.length === 0 ? (
          <p className="text-muted-foreground text-sm">{liveEmpty}</p>
        ) : (
          <div className="space-y-4">
            {liveItems.map((thread) => (
              <ThreadCard key={thread.id} thread={thread} showSlug={showSlug} />
            ))}
            {liveNext !== null && (
              <Button
                variant="outline"
                size="sm"
                disabled={liveLoading}
                onClick={() => loadMore('live', liveNext, tab, setLiveExtra, setLiveLoading)}>
                {liveLoading ? 'Loading…' : 'Show more'}
              </Button>
            )}
          </div>
        )}
      </section>

      {data.quotes.length > 0 && (
        <section className="space-y-4">
          <h2 className="font-serif text-2xl font-semibold tracking-tight">
            Best of the morning after
          </h2>
          <div className="grid gap-4 md:grid-cols-2">
            {data.quotes.map((q) => {
              const when =
                relativeToAir(q.hoursAfterAir, q.daysAfterAir, q.postedAt) ??
                formatDateTime(q.postedAt, q.postedDateOnly)
              return (
                <blockquote key={q.threadId} className="bg-card rounded-xl border p-5">
                  <p className="font-serif text-xl leading-snug italic">
                    <span className="text-brand">“</span>
                    {q.pullQuote}
                    <span className="text-brand">”</span>
                  </p>
                  <footer className="text-muted-foreground mt-3 text-xs">
                    — {q.posterName ?? 'unknown'}, {when} ·{' '}
                    <Link to={`/${showSlug}/thread/${q.threadId}`} className="hover:underline">
                      {q.subject}
                    </Link>
                  </footer>
                </blockquote>
              )
            })}
          </div>
        </section>
      )}

      <section className="space-y-4">
        <h2 className="font-serif text-2xl font-semibold tracking-tight">Over the years</h2>
        {retroItems.length === 0 ? (
          <p className="text-muted-foreground text-sm">Nobody came back to this one later.</p>
        ) : (
          <div className="space-y-4">
            {retroItems.map((thread) => (
              <ThreadCard key={thread.id} thread={thread} showSlug={showSlug} />
            ))}
            {retroNext !== null && (
              <Button
                variant="outline"
                size="sm"
                disabled={retroLoading}
                onClick={() => loadMore('retro', retroNext, 'all', setRetroExtra, setRetroLoading)}>
                {retroLoading ? 'Loading…' : 'Show more'}
              </Button>
            )}
          </div>
        )}
      </section>

      <nav className="flex justify-between text-sm">
        {data.prev ? (
          <Link to={`/${showSlug}/${data.prev.slug}`} className="hover:underline">
            ← {episodeCode(data.prev.seasonNumber, data.prev.number)} {data.prev.title}
          </Link>
        ) : (
          <span className="text-muted-foreground" />
        )}
        {data.next ? (
          <Link to={`/${showSlug}/${data.next.slug}`} className="hover:underline">
            {episodeCode(data.next.seasonNumber, data.next.number)} {data.next.title} →
          </Link>
        ) : (
          <span className="text-muted-foreground" />
        )}
      </nav>
    </div>
  )

  function changeTab(next: EpisodeFilter) {
    setParams(
      (prev) => {
        const p = new URLSearchParams(prev)
        if (next === 'all') p.delete('tab')
        else p.set('tab', next)
        return p
      },
      { replace: true, preventScrollReset: true }
    )
  }
}
