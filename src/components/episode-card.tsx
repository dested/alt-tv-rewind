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
    <Link to={`/${showSlug}/${episode.slug}`} className="group block space-y-2">
      {episode.imageUrl ? (
        <img src={episode.imageUrl} alt="" className="aspect-video w-full border object-cover" />
      ) : (
        <div className="bg-secondary aspect-video border" />
      )}
      <div className="group-hover:text-link font-serif text-base leading-snug font-medium">
        {code} {episode.title}
      </div>
      <div className="text-muted-foreground text-xs tabular-nums">
        {formatAirDate(episode.airDate, 'short')} · {stat}
      </div>
    </Link>
  )
}
