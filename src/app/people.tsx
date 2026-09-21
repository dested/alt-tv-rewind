import { Link, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useTRPC } from '~/lib/trpc'
import { SectionHeading } from '~/components/section-heading'
import { formatNumber, formatYear } from '~/lib/format'

function activeYears(first: string | null, last: string | null): string {
  if (first === null || last === null) return '—'
  return `${formatYear(first)}–${formatYear(last)}`
}

export function PeoplePage() {
  const { show } = useParams()
  const trpc = useTRPC()

  const showQuery = useQuery(
    trpc.shows.get.queryOptions({ slug: show ?? '' }, { enabled: Boolean(show) })
  )
  const topQuery = useQuery(
    trpc.posters.top.queryOptions({ slug: show ?? '' }, { enabled: Boolean(show) })
  )
  const prophetsQuery = useQuery(
    trpc.posters.prophets.queryOptions({ slug: show ?? '' }, { enabled: Boolean(show) })
  )

  const showData = showQuery.data
  if (!show || !showData) return <p className="text-muted-foreground text-sm">Loading…</p>

  const archive = showData.archive
  const top = topQuery.data ?? []
  const prophets = prophetsQuery.data ?? []

  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-serif text-5xl leading-[1.05] font-semibold tracking-tight text-balance">
          People
        </h1>
        {archive && (
          <p className="text-muted-foreground text-sm">
            {formatNumber(archive.messageCount)} posts by the regulars of {archive.newsgroup}
          </p>
        )}
      </div>

      <div className="grid gap-8 md:grid-cols-2">
        <section className="space-y-5">
          <SectionHeading>Most prolific</SectionHeading>
          <table className="w-full text-sm tabular-nums">
            <thead>
              <tr className="text-muted-foreground text-left">
                <th className="text-xs font-medium">Name</th>
                <th className="text-xs font-medium">Posts</th>
                <th className="text-xs font-medium">Threads</th>
                <th className="text-xs font-medium">Active</th>
              </tr>
            </thead>
            <tbody>
              {top.map((p) => (
                <tr key={p.id} className="border-t">
                  <td>
                    <Link to={`/${show}/people/${p.id}`} className="text-link">
                      {p.displayName}
                    </Link>
                  </td>
                  <td>{formatNumber(p.messageCount)}</td>
                  <td>{formatNumber(p.threadCount)}</td>
                  <td className="text-muted-foreground">
                    {activeYears(p.firstPostAt, p.lastPostAt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section className="space-y-5">
          <SectionHeading>The prophets</SectionHeading>
          {prophets.length === 0 ? (
            <p className="text-muted-foreground text-sm">No graded predictions yet.</p>
          ) : (
            <table className="w-full text-sm tabular-nums">
              <thead>
                <tr className="text-muted-foreground text-left">
                  <th className="text-xs font-medium">Name</th>
                  <th className="text-xs font-medium">Hit rate</th>
                  <th className="text-xs font-medium">Predictions</th>
                </tr>
              </thead>
              <tbody>
                {prophets.map((p) => (
                  <tr key={p.id} className="border-t">
                    <td>
                      <Link to={`/${show}/people/${p.id}`} className="text-link">
                        {p.displayName}
                      </Link>
                    </td>
                    <td>{Math.round(p.hitRate * 100)}%</td>
                    <td>{formatNumber(p.predictionCount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>
    </div>
  )
}
