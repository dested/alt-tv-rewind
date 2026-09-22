import { Fragment } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useTRPC } from '~/lib/trpc'
import { formatNumber } from '~/lib/format'

type SourceKind = 'usenet' | 'forum' | 'capsule'

export function kindLabel(kind: SourceKind): string {
  if (kind === 'forum') return 'forum'
  if (kind === 'capsule') return 'compiled capsules'
  return 'newsgroup'
}

export function coverageYears(from: string | null, to: string | null): string | null {
  const a = from?.slice(0, 4) ?? null
  const b = to?.slice(0, 4) ?? null
  if (a && b) return a === b ? a : `${a}–${b}`
  return a ?? b
}

export function SourcesPage() {
  const trpc = useTRPC()
  const query = useQuery(trpc.sources.list.queryOptions())
  const data = query.data
  if (!data) return <p className="text-muted-foreground text-sm">Loading…</p>

  return (
    <div className="space-y-8">
      <div className="space-y-2">
        <h1 className="font-serif text-5xl leading-[1.05] font-semibold tracking-tight text-balance">
          Where the posts come from
        </h1>
        <p className="text-muted-foreground text-sm">
          Every community this archive draws on, and the shows each one feeds
        </p>
      </div>

      {data.length === 0 ? (
        <p className="text-muted-foreground text-sm">No sources catalogued yet.</p>
      ) : (
        <div className="border-t">
          {data.map((s) => {
            const years = coverageYears(s.coverageFrom, s.coverageTo)
            return (
              <article key={s.key} className="space-y-1 border-b py-5">
                <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                  <Link
                    to={`/sources/${s.key}`}
                    className="text-link font-serif text-xl leading-snug font-medium hover:underline">
                    {s.name}
                  </Link>
                  <span className="text-muted-foreground text-sm">
                    {formatNumber(s.recordCount)} records
                  </span>
                </div>
                <p className="text-muted-foreground text-sm">
                  {kindLabel(s.kind)}
                  {years && ` · ${years}`}
                </p>
                {s.shows.length > 0 && (
                  <p className="text-sm">
                    {s.shows.map((sh, i) => (
                      <Fragment key={sh.slug}>
                        {i > 0 && <span className="text-muted-foreground"> · </span>}
                        <Link to={`/${sh.slug}`} className="text-link hover:underline">
                          {sh.name}
                        </Link>
                      </Fragment>
                    ))}
                  </p>
                )}
              </article>
            )
          })}
        </div>
      )}
    </div>
  )
}
