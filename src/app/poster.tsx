import { Fragment, type ReactNode } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useTRPC } from '~/lib/trpc'
import { Badge } from '~/components/badge'
import { Sparkline } from '~/components/sparkline'
import { ThreadCard } from '~/components/thread-card'
import { PREDICTION_OUTCOME } from '~/lib/taxonomy'
import { formatDate, formatNumber, formatYear, plural } from '~/lib/format'

// Fill the poster's per-year counts across the whole active range (zeros for
// years with no posts) so the sparkline reads as a continuous timeline.
function fillYears(byYear: Array<{ year: number; messages: number }>): {
  values: number[]
  firstYear: number | null
  lastYear: number | null
} {
  const first = byYear[0]
  const last = byYear[byYear.length - 1]
  if (!first || !last) return { values: [], firstYear: null, lastYear: null }
  const counts = new Map(byYear.map((r) => [r.year, r.messages]))
  const values: number[] = []
  for (let y = first.year; y <= last.year; y++) values.push(counts.get(y) ?? 0)
  return { values, firstYear: first.year, lastYear: last.year }
}

export function PosterPage() {
  const { show, id } = useParams()
  const trpc = useTRPC()

  const posterId = Number(id)
  const posterQuery = useQuery(
    trpc.posters.get.queryOptions(
      { id: posterId },
      { enabled: Number.isInteger(posterId) && posterId > 0 }
    )
  )

  const data = posterQuery.data
  if (!show || !data) return <p className="text-muted-foreground text-sm">Loading…</p>

  const { poster, shows, byYear, threadsStarted, predictions } = data
  const { values, firstYear, lastYear } = fillYears(byYear)

  const metaSegments: ReactNode[] = [
    `${plural(poster.messageCount, 'post')} across ${plural(shows.length, 'show')}`,
  ]
  if (poster.firstPostAt && poster.lastPostAt) {
    metaSegments.push(`active ${formatYear(poster.firstPostAt)}–${formatYear(poster.lastPostAt)}`)
  }
  metaSegments.push(`${plural(poster.threadCount, 'thread')} started`)
  if (poster.predictionCount > 0) {
    metaSegments.push(
      `${formatNumber(poster.predictionHits)}/${formatNumber(poster.predictionCount)} predictions came true`
    )
  }

  return (
    <div className="space-y-8">
      <div className="space-y-2">
        <div>
          <h1 className="font-serif text-4xl font-semibold tracking-tight text-balance">
            {poster.displayName}
          </h1>
          <div className="text-muted-foreground flex flex-wrap gap-x-2 text-sm">
            {metaSegments.map((seg, i) => (
              <Fragment key={i}>
                {i > 0 && <span aria-hidden>·</span>}
                {seg}
              </Fragment>
            ))}
          </div>
        </div>

        {values.length > 0 && (
          <div className="space-y-1">
            <Sparkline values={values} width={240} height={32} title="posts per year" />
            {firstYear !== null && lastYear !== null && (
              <p className="text-muted-foreground text-xs tabular-nums">
                {firstYear} → {lastYear}
              </p>
            )}
          </div>
        )}

        {shows.length > 1 && (
          <p className="text-muted-foreground text-sm">
            Also posted to:{' '}
            {shows.map((s, i) => (
              <Fragment key={s.slug}>
                {i > 0 && ', '}
                <Link to={`/${s.slug}`} className="hover:underline">
                  {s.name}
                </Link>
              </Fragment>
            ))}
          </p>
        )}
      </div>

      <section className="space-y-4">
        <h2 className="font-serif text-2xl font-semibold tracking-tight">Threads started</h2>
        {threadsStarted.length === 0 ? (
          <p className="text-muted-foreground text-sm">Never started a thread — a replier.</p>
        ) : (
          <div className="space-y-4">
            {threadsStarted.map((thread) => (
              <ThreadCard key={thread.id} thread={thread} showSlug={show} />
            ))}
          </div>
        )}
      </section>

      {predictions.length > 0 && (
        <section className="space-y-4">
          <h2 className="font-serif text-2xl font-semibold tracking-tight">Predictions</h2>
          <ul className="space-y-3">
            {predictions.map((p) => {
              const outcome = p.predictionOutcome ? PREDICTION_OUTCOME[p.predictionOutcome] : null
              return (
                <li key={p.threadId} className="space-y-1">
                  <div className="flex flex-wrap items-baseline gap-x-2 text-sm">
                    <Link
                      to={`/${show}/thread/${p.threadId}`}
                      className="font-medium hover:underline">
                      {p.subject}
                    </Link>
                    {outcome && (
                      <Badge variant={outcome.variant}>
                        {outcome.glyph} {outcome.label}
                      </Badge>
                    )}
                    <span className="text-muted-foreground">{formatDate(p.startedAt)}</span>
                  </div>
                  <p className="font-serif text-[0.95rem] italic">{p.predictionClaim}</p>
                </li>
              )
            })}
          </ul>
        </section>
      )}
    </div>
  )
}
