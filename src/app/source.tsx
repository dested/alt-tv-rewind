import { Link, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useTRPC } from '~/lib/trpc'
import { SectionHeading } from '~/components/section-heading'
import { episodeCode, formatMonth, formatNumber } from '~/lib/format'
import { coverageYears, kindLabel } from './sources'

type ShowRow = {
  slug: string
  name: string
  posts: number
  threads: number
  accepted: number
  context: number
  excluded: number
  needsReview: number
}

export function SourcePage() {
  const { key } = useParams()
  const trpc = useTRPC()
  const query = useQuery(
    trpc.sources.get.queryOptions({ key: key ?? '' }, { enabled: Boolean(key) })
  )
  const data = query.data
  if (!data) return <p className="text-muted-foreground text-sm">Loading…</p>

  const years = coverageYears(data.coverageFrom, data.coverageTo)
  const meta = [kindLabel(data.kind), data.key, data.custodian, years].filter(
    (x): x is string => Boolean(x)
  )

  const bySlug = new Map<string, ShowRow>()
  for (const s of data.shows) {
    bySlug.set(s.slug, {
      slug: s.slug,
      name: s.name,
      posts: s.messageCount,
      threads: s.threadCount,
      accepted: 0,
      context: 0,
      excluded: 0,
      needsReview: 0,
    })
  }
  for (const d of data.dispositions) {
    const cur = bySlug.get(d.show.slug) ?? {
      slug: d.show.slug,
      name: d.show.name,
      posts: 0,
      threads: 0,
      accepted: 0,
      context: 0,
      excluded: 0,
      needsReview: 0,
    }
    cur.accepted = d.accepted
    cur.context = d.context
    cur.excluded = d.excluded
    cur.needsReview = d.needsReview
    bySlug.set(d.show.slug, cur)
  }
  const showRows = [...bySlug.values()].sort((a, b) => a.name.localeCompare(b.name))

  const art = data.artifacts
  const capturesSentence =
    art.count === 0
      ? 'No captures recorded for this source.'
      : `${formatNumber(art.count)} ${art.count === 1 ? 'capture' : 'captures'}` +
        (art.formats.length ? ` in ${art.formats.join(', ')}` : '') +
        (art.earliestCapturedAt ? `, earliest ${formatMonth(art.earliestCapturedAt, 'long')}` : '') +
        '.'

  return (
    <div className="space-y-10">
      <div className="space-y-2">
        <h1 className="font-serif text-5xl leading-[1.05] font-semibold tracking-tight text-balance">
          {data.name}
        </h1>
        <p className="text-muted-foreground text-sm">{meta.join(' · ')}</p>
        {(data.homeUrl || data.collectionUrl) && (
          <p className="text-sm">
            {data.homeUrl && (
              <a href={data.homeUrl} target="_blank" rel="noreferrer" className="text-link hover:underline">
                Browse source
              </a>
            )}
            {data.homeUrl && data.collectionUrl && (
              <span className="text-muted-foreground"> · </span>
            )}
            {data.collectionUrl && (
              <a
                href={data.collectionUrl}
                target="_blank"
                rel="noreferrer"
                className="text-link hover:underline">
                Archive collection
              </a>
            )}
          </p>
        )}
      </div>

      {data.notes.length > 0 && (
        <section className="space-y-3">
          <SectionHeading>Notes</SectionHeading>
          <ul className="text-muted-foreground list-disc space-y-1 pl-5 text-sm">
            {data.notes.map((note, i) => (
              <li key={i}>{note}</li>
            ))}
          </ul>
        </section>
      )}

      <section className="space-y-3">
        <SectionHeading>Shows</SectionHeading>
        {showRows.length === 0 ? (
          <p className="text-muted-foreground text-sm">No shows draw on this source yet.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-muted-foreground border-b text-left text-xs font-medium">
                <th className="py-2 font-medium">Show</th>
                <th className="py-2 text-right font-medium">Posts</th>
                <th className="py-2 text-right font-medium">Threads</th>
                <th className="py-2 text-right font-medium">Accepted</th>
                <th className="py-2 text-right font-medium">Context</th>
                <th className="py-2 text-right font-medium">Excluded</th>
                <th className="py-2 text-right font-medium">Needs review</th>
              </tr>
            </thead>
            <tbody>
              {showRows.map((r) => (
                <tr key={r.slug} className="border-b">
                  <td className="py-2">
                    <Link to={`/${r.slug}`} className="text-link hover:underline">
                      {r.name}
                    </Link>
                  </td>
                  <td className="py-2 text-right tabular-nums">{formatNumber(r.posts)}</td>
                  <td className="py-2 text-right tabular-nums">{formatNumber(r.threads)}</td>
                  <td className="py-2 text-right tabular-nums">{formatNumber(r.accepted)}</td>
                  <td className="py-2 text-right tabular-nums">{formatNumber(r.context)}</td>
                  <td className="py-2 text-right tabular-nums">{formatNumber(r.excluded)}</td>
                  <td className="py-2 text-right tabular-nums">{formatNumber(r.needsReview)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="space-y-3">
        <SectionHeading>Captures</SectionHeading>
        <p className="text-muted-foreground text-sm">{capturesSentence}</p>
      </section>

      {data.kind === 'capsule' && (
        <section className="space-y-3">
          <SectionHeading>Documents</SectionHeading>
          {data.documents.length === 0 ? (
            <p className="text-muted-foreground text-sm">No documents catalogued yet.</p>
          ) : (
            <div className="border-t">
              {data.documents.map((d) => (
                <article key={d.recordId} className="space-y-1 border-b py-4">
                  <div className="font-serif text-xl leading-snug font-medium">{d.title}</div>
                  <p className="text-muted-foreground text-sm">
                    {d.episode && d.showSlug && (
                      <>
                        <Link to={`/${d.showSlug}/${d.episode.slug}`} className="text-link">
                          {episodeCode(d.episode.seasonNumber, d.episode.number)} {d.episode.title}
                        </Link>
                        {' · '}
                      </>
                    )}
                    {formatNumber(d.contributionCount)} attributed contributions
                    {d.revision !== null && ` · revision ${d.revision}`}
                    {d.originalUrl && (
                      <>
                        {' · '}
                        <a
                          href={d.originalUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="text-link hover:underline">
                          Original document
                        </a>
                      </>
                    )}
                  </p>
                </article>
              ))}
            </div>
          )}
          <p className="text-muted-foreground text-sm">
            Compiled documents are cataloged locally; their text is not republished.
          </p>
        </section>
      )}
    </div>
  )
}
