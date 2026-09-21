import { Link, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useTRPC } from '~/lib/trpc'
import { EpisodeCard } from '~/components/episode-card'
import { PhraseGrid } from '~/components/phrase-grid'
import { StatRow } from '~/components/stat-row'
import { ThenVsNow } from '~/components/then-vs-now'
import { VolumeTimeline } from '~/components/volume-timeline'
import type { RouterOutputs } from '~/lib/api-types'
import { episodeCode, formatMonth, formatNumber, plural } from '~/lib/format'

type ShowData = RouterOutputs['shows']['get']
type EpisodeCardData = ShowData['topEpisodes'][number]

const MINUS = '−'
function signed(score: number | null): string {
  if (score === null) return '—'
  return `${score < 0 ? MINUS : '+'}${Math.abs(score).toFixed(1)}`
}

function yearRange(premiered: string | null, ended: string | null): string {
  const from = premiered?.slice(0, 4)
  const to = ended?.slice(0, 4)
  if (from && to) return `${from}–${to}`
  return from ?? to ?? ''
}

function joinDot(parts: Array<string | null | undefined>): string {
  return parts.filter((p): p is string => Boolean(p)).join(' · ')
}

// A brand (live-signal) bar in a neutral track, scaled to the section maximum.
function LiveBar({ count, max }: { count: number; max: number }) {
  const pct = max > 0 ? (count / max) * 100 : 0
  return (
    <div className="flex items-center gap-2">
      <div className="bg-secondary h-2 w-28 overflow-hidden rounded-sm">
        <div className="bg-brand h-full rounded-sm" style={{ width: `${pct}%` }} />
      </div>
      <span>{formatNumber(count)}</span>
    </div>
  )
}

function ScoreList({
  episodes,
  showSlug,
  label,
}: {
  episodes: EpisodeCardData[]
  showSlug: string
  label: string
}) {
  return (
    <div className="space-y-2">
      <div className="text-sm font-medium">{label}</div>
      <ul className="space-y-2 text-sm">
        {episodes.map((e) => (
          <li key={e.id} className="flex items-baseline justify-between gap-3">
            <Link to={`/${showSlug}/${e.slug}`} className="hover:underline">
              <span className="text-muted-foreground tabular-nums">
                {episodeCode(e.seasonNumber, e.number)}
              </span>{' '}
              {e.title}
            </Link>
            <span className="tabular-nums">{signed(e.usenetScore)}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

export function ShowPage() {
  const { show: slug } = useParams()
  const trpc = useTRPC()

  const showQuery = useQuery({
    ...trpc.shows.get.queryOptions({ slug: slug ?? '' }),
    enabled: !!slug,
  })
  const timelineQuery = useQuery({
    ...trpc.shows.timeline.queryOptions({ slug: slug ?? '' }),
    enabled: !!slug,
  })
  const thenVsNowQuery = useQuery({
    ...trpc.shows.thenVsNow.queryOptions({ slug: slug ?? '' }),
    enabled: !!slug,
  })
  const phrasesQuery = useQuery({
    ...trpc.shows.phrases.queryOptions({ slug: slug ?? '' }),
    enabled: !!slug,
  })

  if (!slug) return null
  const data = showQuery.data
  const timeline = timelineQuery.data
  const thenVsNow = thenVsNowQuery.data
  const phrases = phrasesQuery.data
  if (!data || !timeline || !thenVsNow || !phrases) {
    return <p className="text-muted-foreground text-sm">Loading…</p>
  }

  const { show, archive, seasons, topEpisodes, mostLoved, mostHated } = data
  const episodeTotal = seasons.reduce((sum, s) => sum + s.episodeCount, 0)
  const liveTotal = seasons.reduce((sum, s) => sum + s.liveMessageCount, 0)
  const retroTotal = seasons.reduce((sum, s) => sum + s.retroMessageCount, 0)
  const maxSeasonLive = Math.max(...seasons.map((s) => s.liveMessageCount), 1)

  const meta = joinDot([
    yearRange(show.premiered, show.ended),
    show.network,
    plural(seasons.length, 'season'),
    plural(episodeTotal, 'episode'),
  ])

  const archiveLine = archive
    ? joinDot([
        archive.newsgroup,
        `${formatNumber(archive.messageCount)} posts in ${formatNumber(archive.threadCount)} threads`,
        archive.firstPostAt && archive.lastPostAt
          ? `${formatMonth(archive.firstPostAt, 'long')} – ${formatMonth(archive.lastPostAt, 'long')}`
          : null,
      ])
    : null

  const statItems: Array<{ value: string; label: string }> = [
    { value: formatNumber(liveTotal), label: 'live posts' },
    { value: formatNumber(retroTotal), label: 'retro posts' },
  ]
  const topEpisode = topEpisodes[0]
  if (topEpisode) statItems.push({ value: topEpisode.title, label: 'most-discussed episode' })

  return (
    <div className="space-y-10">
      <section className="space-y-4">
        <div className="flex gap-6">
          {show.imageUrl && (
            <img
              src={show.imageUrl}
              alt=""
              className="aspect-[2/3] w-28 shrink-0 rounded-md object-cover"
            />
          )}
          <div className="space-y-1">
            <h1 className="text-3xl font-bold tracking-tight">{show.name}</h1>
            <p className="text-muted-foreground text-sm">{meta}</p>
            {archiveLine && <p className="text-muted-foreground text-sm">{archiveLine}</p>}
          </div>
        </div>
        {archive && <StatRow items={statItems} />}
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold tracking-tight">Every post, every night</h2>
        <VolumeTimeline
          days={timeline.days}
          episodes={timeline.episodes}
          seasons={timeline.seasons}
          showSlug={slug}
        />
        <p className="text-muted-foreground text-sm">
          Weekly posts. Ticks mark first airings; hover for the nearest episode.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold tracking-tight">Seasons</h2>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-muted-foreground text-left text-xs tracking-wide uppercase">
              <th className="py-2 font-medium">Season</th>
              <th className="py-2 font-medium">Aired</th>
              <th className="py-2 font-medium">Episodes</th>
              <th className="py-2 font-medium">Live posts</th>
              <th className="py-2 font-medium">Retro posts</th>
            </tr>
          </thead>
          <tbody>
            {seasons.map((s) => (
              <tr key={s.number} className="border-t">
                <td className="py-2">
                  <Link to={`/${slug}/season/${s.number}`} className="hover:underline">
                    Season {s.number}
                  </Link>
                </td>
                <td className="py-2 tabular-nums">{yearRange(s.premiered, s.ended)}</td>
                <td className="py-2 tabular-nums">{formatNumber(s.episodeCount)}</td>
                <td className="py-2 tabular-nums">
                  <LiveBar count={s.liveMessageCount} max={maxSeasonLive} />
                </td>
                <td className="py-2 tabular-nums">{formatNumber(s.retroMessageCount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {topEpisodes.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-xl font-semibold tracking-tight">Most discussed</h2>
          <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-4">
            {topEpisodes.map((e) => (
              <EpisodeCard key={e.id} episode={e} showSlug={slug} />
            ))}
          </div>
        </section>
      )}

      {(mostLoved.length > 0 || mostHated.length > 0) && (
        <section className="space-y-3">
          <h2 className="text-xl font-semibold tracking-tight">Loved then, hated then</h2>
          <div className="grid gap-8 md:grid-cols-2">
            {mostLoved.length > 0 && (
              <ScoreList episodes={mostLoved} showSlug={slug} label="Loved then" />
            )}
            {mostHated.length > 0 && (
              <ScoreList episodes={mostHated} showSlug={slug} label="Hated then" />
            )}
          </div>
        </section>
      )}

      {thenVsNow.length >= 5 && (
        <section className="space-y-3">
          <h2 className="text-xl font-semibold tracking-tight">Then vs now</h2>
          <ThenVsNow items={thenVsNow} showSlug={slug} />
          <p className="text-muted-foreground text-sm">
            Usenet score at the time against today's TVMaze rating. Labeled dots are the biggest
            gaps.
          </p>
        </section>
      )}

      {phrases.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-xl font-semibold tracking-tight">Catchphrases</h2>
          <PhraseGrid phrases={phrases} showSlug={slug} />
        </section>
      )}
    </div>
  )
}
