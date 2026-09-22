import { Fragment } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useTRPC } from '~/lib/trpc'
import { MessageBody } from '~/components/message-body'
import { SectionHeading } from '~/components/section-heading'
import { SourceLine } from '~/components/source-line'
import { episodeCode, formatAirDate, formatDateTime } from '~/lib/format'
import { stripRe } from '~/lib/usenet'

export function SourceRecordPage() {
  const { key, recordId } = useParams()
  const trpc = useTRPC()
  const query = useQuery(
    trpc.sources.record.queryOptions(
      { key: key ?? '', recordId: recordId ?? '' },
      { enabled: Boolean(key && recordId) }
    )
  )
  const data = query.data
  if (!data) return <p className="text-muted-foreground text-sm">Loading…</p>

  const dateText =
    data.postedAt !== null
      ? formatDateTime(data.postedAt, data.datePrecision === 'day')
      : data.postedDate !== null
        ? formatAirDate(data.postedDate, 'short')
        : 'date unknown'
  const dateMeta = data.dateRaw ? `${dateText} (as printed: ${data.dateRaw})` : dateText
  const meta = [data.authorName, dateMeta].filter((x): x is string => Boolean(x))

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <div className="space-y-2">
        <h1 className="font-serif text-4xl leading-[1.1] font-semibold tracking-tight text-balance">
          {stripRe(data.title)}
        </h1>
        <p className="text-muted-foreground text-sm">{meta.join(' · ')}</p>
        <SourceLine location={data.location} />
      </div>

      <MessageBody body={data.body} />

      <section className="space-y-3">
        <SectionHeading>Shows</SectionHeading>
        {data.shows.length === 0 ? (
          <p className="text-muted-foreground text-sm">Not associated with any show.</p>
        ) : (
          <div className="border-t">
            {data.shows.map((s) => (
              <div
                key={s.slug}
                className="flex flex-wrap items-baseline gap-x-2 gap-y-1 border-b py-4 text-sm">
                <Link to={`/${s.slug}`} className="text-link hover:underline">
                  {s.name}
                </Link>
                <span className="text-muted-foreground">{s.status}</span>
                {s.episode && (
                  <>
                    <span className="text-muted-foreground" aria-hidden>
                      ·
                    </span>
                    <Link to={`/${s.slug}/${s.episode.slug}`} className="text-link hover:underline">
                      {episodeCode(s.episode.seasonNumber, s.episode.number)} {s.episode.title}
                    </Link>
                  </>
                )}
                {s.thread && (
                  <>
                    <span className="text-muted-foreground" aria-hidden>
                      ·
                    </span>
                    <Link
                      to={`/${s.slug}/thread/${s.thread.slug}`}
                      className="text-link hover:underline">
                      Read the thread
                    </Link>
                  </>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      {data.observations.length > 0 && (
        <section className="space-y-3">
          <SectionHeading>Captures</SectionHeading>
          <div className="border-t">
            {data.observations.map((o, i) => (
              <div key={i} className="space-y-0.5 border-b py-4 text-sm">
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                  <span className="text-muted-foreground">
                    {o.capturedAt !== null ? formatDateTime(o.capturedAt) : 'capture date unknown'}
                  </span>
                  {o.archivedUrl && (
                    <>
                      <span className="text-muted-foreground" aria-hidden>
                        ·
                      </span>
                      <a
                        href={o.archivedUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-link hover:underline">
                        Archived copy
                      </a>
                    </>
                  )}
                  {o.archiveCollectionId && (
                    <>
                      <span className="text-muted-foreground" aria-hidden>
                        ·
                      </span>
                      <span className="text-muted-foreground">{o.archiveCollectionId}</span>
                    </>
                  )}
                </div>
                {o.differsFromRecord && (
                  <p className="text-muted-foreground text-xs">
                    text differs from the canonical record
                  </p>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {data.alsoSeenIn.length > 0 && (
        <section className="space-y-3">
          <SectionHeading>Also seen in</SectionHeading>
          <p className="text-sm">
            {data.alsoSeenIn.map((a, i) => (
              <Fragment key={a.recordId}>
                {i > 0 && <span className="text-muted-foreground"> · </span>}
                <Link
                  to={`/sources/${a.source.key}/records/${a.recordId}`}
                  className="text-link hover:underline">
                  {a.source.name}
                </Link>
              </Fragment>
            ))}
          </p>
        </section>
      )}
    </div>
  )
}
