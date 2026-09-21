import { Link } from 'react-router-dom'
import type { EpisodeCard as EpisodeCardData } from '~/lib/api-types'
import { episodeCode, formatAirDate, formatNumber } from '~/lib/format'

export function EpisodeCard({ episode, showSlug }: { episode: EpisodeCardData; showSlug: string }) {
  const code = episodeCode(episode.seasonNumber, episode.number)
  const live =
    episode.liveMessageCount === 0
      ? 'no live reaction'
      : `${formatNumber(episode.liveMessageCount)} live posts`
  const stat =
    episode.retroMessageCount > 0
      ? `${live} · ${formatNumber(episode.retroMessageCount)} later`
      : live

  return (
    <Link
      to={`/${showSlug}/${episode.slug}`}
      className="bg-card hover:border-foreground/30 block overflow-hidden rounded-lg border transition-colors">
      {episode.imageUrl ? (
        <img src={episode.imageUrl} alt="" className="aspect-video w-full object-cover" />
      ) : (
        <div className="bg-secondary aspect-video" />
      )}
      <div className="space-y-1 p-3">
        <div className="leading-snug font-medium">{episode.title}</div>
        <div className="text-muted-foreground text-xs tabular-nums">
          {code} · {formatAirDate(episode.airDate, 'short')}
        </div>
        <div className="text-muted-foreground text-sm tabular-nums">{stat}</div>
      </div>
    </Link>
  )
}
