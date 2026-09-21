import { Link, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useTRPC } from '~/lib/trpc'
import { episodeCode, formatAirDate, formatMonth, formatNumber, plural } from '~/lib/format'

const MINUS = '−'
function signed(score: number | null): string {
  if (score === null) return '—'
  return `${score < 0 ? MINUS : '+'}${Math.abs(score).toFixed(1)}`
}

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

export function SeasonPage() {
  const { show: slug, n } = useParams()
  const trpc = useTRPC()
  const seasonNumber = Number(n)

  const showQuery = useQuery({
    ...trpc.shows.get.queryOptions({ slug: slug ?? '' }),
    enabled: !!slug,
  })
  const episodesQuery = useQuery({
    ...trpc.episodes.list.queryOptions({ slug: slug ?? '', season: seasonNumber }),
    enabled: !!slug && Number.isInteger(seasonNumber),
  })

  if (!slug || !n) return null
  const showData = showQuery.data
  const episodes = episodesQuery.data
  if (!showData || !episodes) {
    return <p className="text-muted-foreground text-sm">Loading…</p>
  }

  const seasonRow = showData.seasons.find((s) => s.number === seasonNumber)
  const prevSeason = showData.seasons.find((s) => s.number === seasonNumber - 1)
  const nextSeason = showData.seasons.find((s) => s.number === seasonNumber + 1)
  const maxLive = Math.max(...episodes.map((e) => e.liveMessageCount), 1)

  const meta = seasonRow
    ? [
        plural(seasonRow.episodeCount, 'episode'),
        seasonRow.premiered && seasonRow.ended
          ? `${formatMonth(seasonRow.premiered, 'long')} – ${formatMonth(seasonRow.ended, 'long')}`
          : null,
      ]
        .filter((p): p is string => Boolean(p))
        .join(' · ')
    : ''

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="font-serif text-4xl font-semibold tracking-tight text-balance">
          Season {seasonNumber}
        </h1>
        {meta && <p className="text-muted-foreground text-sm">{meta}</p>}
      </div>

      <table className="w-full text-sm">
        <thead>
          <tr className="text-muted-foreground text-left text-xs">
            <th className="py-2 font-medium">Code</th>
            <th className="py-2 font-medium">Title</th>
            <th className="py-2 font-medium">Aired</th>
            <th className="py-2 font-medium">Live posts</th>
            <th className="py-2 font-medium">Retro posts</th>
            <th className="py-2 font-medium">Usenet score</th>
          </tr>
        </thead>
        <tbody>
          {episodes.map((e) => (
            <tr key={e.id} className="border-t">
              <td className="py-2 tabular-nums">{episodeCode(e.seasonNumber, e.number)}</td>
              <td className="py-2">
                <Link to={`/${slug}/${e.slug}`} className="hover:underline">
                  {e.title}
                </Link>
              </td>
              <td className="py-2 tabular-nums">{formatAirDate(e.airDate, 'short')}</td>
              <td className="py-2 tabular-nums">
                <LiveBar count={e.liveMessageCount} max={maxLive} />
              </td>
              <td className="py-2 tabular-nums">{formatNumber(e.retroMessageCount)}</td>
              <td className="py-2 tabular-nums">{signed(e.usenetScore)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="flex justify-between text-sm">
        {prevSeason ? (
          <Link to={`/${slug}/season/${prevSeason.number}`} className="hover:underline">
            ← Season {prevSeason.number}
          </Link>
        ) : (
          <span />
        )}
        {nextSeason ? (
          <Link to={`/${slug}/season/${nextSeason.number}`} className="hover:underline">
            Season {nextSeason.number} →
          </Link>
        ) : (
          <span />
        )}
      </div>
    </div>
  )
}
