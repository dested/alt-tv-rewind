import { Fragment, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import type { ThreadCard as ThreadCardData } from '~/lib/api-types'
import { Badge } from '~/components/badge'
import { KIND, PREDICTION_OUTCOME, SENTIMENT } from '~/lib/taxonomy'
import { formatDate, plural, relativeToAir } from '~/lib/format'

function MetaLine({ segments }: { segments: ReactNode[] }) {
  return (
    <div className="text-muted-foreground text-sm">
      {segments.map((seg, i) => (
        <Fragment key={i}>
          {i > 0 && <span aria-hidden> · </span>}
          {seg}
        </Fragment>
      ))}
    </div>
  )
}

export function ThreadCard({ thread, showSlug }: { thread: ThreadCardData; showSlug: string }) {
  const when = relativeToAir(thread.hoursAfterAir, thread.startedAt) ?? formatDate(thread.startedAt)

  const segments: ReactNode[] = [
    thread.starter ? (
      <Link to={`/${showSlug}/people/${thread.starter.id}`} className="hover:underline">
        {thread.starter.displayName}
      </Link>
    ) : (
      'unknown'
    ),
    when,
    plural(thread.messageCount, 'post'),
  ]
  if (thread.messageCount !== 1) segments.push(plural(thread.posterCount, 'poster'))

  const badges: ReactNode[] = []
  if (thread.kind && thread.kind !== 'reaction') {
    badges.push(
      <Badge key="kind" variant="neutral">
        {KIND[thread.kind].glyph} {KIND[thread.kind].label}
      </Badge>
    )
  }
  if (thread.sentiment && thread.sentiment !== 'neutral') {
    const s = SENTIMENT[thread.sentiment]
    badges.push(
      <Badge key="sentiment" variant={s.variant}>
        {s.glyph} {s.label}
      </Badge>
    )
  }
  if (thread.controversy > 0) {
    badges.push(
      <Badge key="controversy" variant="brand">
        🔥 Controversial
      </Badge>
    )
  }
  if (thread.predictionOutcome) {
    const o = PREDICTION_OUTCOME[thread.predictionOutcome]
    badges.push(
      <Badge key="outcome" variant={o.variant}>
        {o.glyph} {o.label}
      </Badge>
    )
  }

  return (
    <article className="bg-card space-y-1.5 rounded-lg border p-4">
      <div>
        <Link
          to={`/${showSlug}/thread/${thread.id}`}
          className="font-medium leading-snug hover:underline">
          {thread.subject}
        </Link>
      </div>
      <MetaLine segments={segments} />
      {badges.length > 0 && <div className="flex flex-wrap gap-1.5">{badges}</div>}
      {thread.predictionClaim && <p className="text-sm italic">{thread.predictionClaim}</p>}
      {thread.summary && <p className="text-sm">{thread.summary}</p>}
    </article>
  )
}
