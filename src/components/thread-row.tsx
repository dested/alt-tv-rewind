import { Fragment, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import type { ThreadCard } from '~/lib/api-types'
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

// A ruled list row (replaces the old card). Rendered inside a `border-t` wrapper
// so the first row carries a rule above it too.
export function ThreadRow({ thread, showSlug }: { thread: ThreadCard; showSlug: string }) {
  const when =
    relativeToAir(thread.hoursAfterAir, thread.daysAfterAir, thread.startedAt) ??
    formatDate(thread.startedAt)

  const segments: ReactNode[] = [
    thread.starter ? (
      <Link to={`/${showSlug}/people/${thread.starter.id}`} className="text-link">
        {thread.starter.displayName}
      </Link>
    ) : (
      'unknown'
    ),
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
    <article className="grid gap-x-6 gap-y-1 border-b py-4 sm:grid-cols-[9rem_1fr]">
      <div className="text-muted-foreground text-xs sm:text-right">
        <div>{when}</div>
        <div>{plural(thread.messageCount, 'post')}</div>
      </div>
      <div className="min-w-0 space-y-1.5">
        <Link
          to={`/${showSlug}/thread/${thread.slug}`}
          className="hover:text-link block font-serif text-xl leading-snug font-medium">
          {thread.subject}
        </Link>
        <MetaLine segments={segments} />
        {badges.length > 0 && <div className="flex flex-wrap gap-1.5">{badges}</div>}
        {thread.predictionClaim && (
          <p className="font-serif text-[1rem] italic">{thread.predictionClaim}</p>
        )}
        {thread.summary && (
          <p className="text-muted-foreground max-w-[66ch] text-sm">{thread.summary}</p>
        )}
      </div>
    </article>
  )
}
