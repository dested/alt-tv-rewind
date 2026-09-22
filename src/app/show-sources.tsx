import { Link, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useTRPC } from '~/lib/trpc'
import { formatNumber } from '~/lib/format'
import { coverageYears, kindLabel } from './sources'

export function ShowSourcesPage() {
  const { show } = useParams()
  const trpc = useTRPC()
  const query = useQuery(
    trpc.sources.forShow.queryOptions({ slug: show ?? '' }, { enabled: Boolean(show) })
  )
  const data = query.data
  if (!data) return <p className="text-muted-foreground text-sm">Loading…</p>

  return (
    <div className="space-y-8">
      <div className="space-y-2">
        <h1 className="font-serif text-5xl leading-[1.05] font-semibold tracking-tight text-balance">
          Sources
        </h1>
        <p className="text-muted-foreground text-sm">{data.show.name}</p>
      </div>

      {data.sources.length === 0 ? (
        <p className="text-muted-foreground text-sm">No sources feed this show yet.</p>
      ) : (
        <div className="border-t">
          {data.sources.map((s) => {
            const years = coverageYears(s.coverageFrom, s.coverageTo)
            const volume =
              s.messageCount === 0 && s.threadCount === 0
                ? null
                : `${formatNumber(s.messageCount)} posts · ${formatNumber(s.threadCount)} threads`
            const disp: string[] = []
            if (s.accepted > 0) disp.push(`accepted ${formatNumber(s.accepted)}`)
            if (s.context > 0) disp.push(`context ${formatNumber(s.context)}`)
            if (s.excluded > 0) disp.push(`excluded ${formatNumber(s.excluded)}`)
            if (s.needsReview > 0) disp.push(`needs review ${formatNumber(s.needsReview)}`)
            return (
              <article key={s.key} className="space-y-1 border-b py-5">
                <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                  <Link
                    to={`/sources/${s.key}`}
                    className="text-link font-serif text-xl leading-snug font-medium hover:underline">
                    {s.name}
                  </Link>
                  {volume && <span className="text-muted-foreground text-sm">{volume}</span>}
                </div>
                <p className="text-muted-foreground text-sm">
                  {kindLabel(s.kind)}
                  {years && ` · ${years}`}
                </p>
                {disp.length > 0 && (
                  <p className="text-muted-foreground text-sm">{disp.join(' · ')}</p>
                )}
                {s.kind === 'capsule' && (
                  <p className="text-muted-foreground text-sm">
                    {formatNumber(s.documents)} compiled documents, metadata only
                  </p>
                )}
                {s.notes.length > 0 && (
                  <ul className="text-muted-foreground list-disc space-y-0.5 pl-5 text-xs">
                    {s.notes.map((note, i) => (
                      <li key={i}>{note}</li>
                    ))}
                  </ul>
                )}
                {(s.homeUrl || s.collectionUrl) && (
                  <p className="text-sm">
                    {s.homeUrl && (
                      <a
                        href={s.homeUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-link hover:underline">
                        Browse source
                      </a>
                    )}
                    {s.homeUrl && s.collectionUrl && (
                      <span className="text-muted-foreground"> · </span>
                    )}
                    {s.collectionUrl && (
                      <a
                        href={s.collectionUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-link hover:underline">
                        Archive collection
                      </a>
                    )}
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
