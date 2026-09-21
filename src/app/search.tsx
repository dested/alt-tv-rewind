import { Fragment, type ReactNode } from 'react'
import { Form, Link, useParams, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useTRPC } from '~/lib/trpc'
import { Button } from '~/components/ui/button'
import { Input } from '~/components/ui/input'
import { snippetToHtml } from '~/lib/snippet'
import { episodeCode, formatDate, formatNumber, plural } from '~/lib/format'

function optionalInt(value: string | null): number | undefined {
  if (value === null || value === '') return undefined
  const n = Number(value)
  return Number.isInteger(n) ? n : undefined
}

export function SearchPage() {
  const { show } = useParams()
  const trpc = useTRPC()
  const [params] = useSearchParams()
  const q = params.get('q')?.trim() ?? ''
  const cursor = optionalInt(params.get('cursor')) ?? 0

  const showQuery = useQuery(
    trpc.shows.get.queryOptions({ slug: show ?? '' }, { enabled: Boolean(show) })
  )
  const results = useQuery(
    trpc.search.query.queryOptions(
      {
        slug: show ?? '',
        q,
        season: optionalInt(params.get('season')),
        episodeId: optionalInt(params.get('episode')),
        yearFrom: optionalInt(params.get('from')),
        yearTo: optionalInt(params.get('to')),
        posterId: optionalInt(params.get('poster')),
        cursor,
      },
      { enabled: Boolean(show) && q !== '' }
    )
  )

  const showData = showQuery.data
  if (!show || !showData) return <p className="text-muted-foreground text-sm">Loading…</p>

  const { archive, seasons } = showData

  function pageHref(nextCursor: number): string {
    const p = new URLSearchParams(params)
    p.set('cursor', String(nextCursor))
    return `?${p.toString()}`
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Search</h1>
        {archive && (
          <p className="text-muted-foreground">
            {archive.newsgroup} · {formatNumber(archive.messageCount)} posts
          </p>
        )}
      </div>

      <Form method="get" className="space-y-3">
        <Input
          name="q"
          key={q}
          defaultValue={q}
          className="h-11 text-base"
          placeholder='festivus, "marble rye", -newman'
          aria-label="Search"
        />
        <div className="flex flex-wrap gap-2">
          <select
            name="season"
            defaultValue={params.get('season') ?? ''}
            className="border-input bg-card h-9 rounded-md border px-2 text-sm">
            <option value="">Any season</option>
            {seasons.map((s) => (
              <option key={s.number} value={s.number}>
                Season {s.number}
              </option>
            ))}
          </select>
          <Input
            name="from"
            type="number"
            defaultValue={params.get('from') ?? ''}
            placeholder="from year"
            className="w-28"
            aria-label="From year"
          />
          <Input
            name="to"
            type="number"
            defaultValue={params.get('to') ?? ''}
            placeholder="to year"
            className="w-28"
            aria-label="To year"
          />
          <Button type="submit">Search</Button>
        </div>
      </Form>

      {q === '' ? (
        <p className="text-muted-foreground text-sm">
          Type something. Quotes for phrases, minus to exclude.
        </p>
      ) : !results.data ? (
        <p className="text-muted-foreground text-sm">Loading…</p>
      ) : results.data.total === 0 ? (
        <p className="text-muted-foreground text-sm">No posts match “{q}”.</p>
      ) : (
        <div className="space-y-6">
          <p className="text-muted-foreground text-sm">
            {plural(results.data.total, 'thread')} {results.data.total === 1 ? 'matches' : 'match'}
          </p>
          {results.data.threads.map(({ thread, hits }) => {
            const meta: ReactNode[] = [formatDate(thread.startedAt)]
            if (thread.episode) {
              meta.push(
                <Link to={`/${show}/${thread.episode.slug}`} className="hover:underline">
                  {episodeCode(thread.episode.seasonNumber, thread.episode.number)}{' '}
                  {thread.episode.title}
                </Link>
              )
            }
            meta.push(plural(thread.messageCount, 'post'))
            return (
              <article key={thread.id} className="bg-card space-y-2 rounded-lg border p-4">
                <div>
                  <Link to={`/${show}/thread/${thread.id}`} className="font-medium hover:underline">
                    {thread.subject}
                  </Link>
                </div>
                <div className="text-muted-foreground flex flex-wrap gap-x-2 text-sm">
                  {meta.map((seg, i) => (
                    <Fragment key={i}>
                      {i > 0 && <span aria-hidden>·</span>}
                      {seg}
                    </Fragment>
                  ))}
                </div>
                {hits.map((hit) => (
                  <div key={hit.messageId} className="usenet text-muted-foreground">
                    <span className="text-foreground/80 font-sans text-xs">
                      {hit.posterName} · {formatDate(hit.postedAt)}
                    </span>
                    <div dangerouslySetInnerHTML={{ __html: snippetToHtml(hit.snippet) }} />
                  </div>
                ))}
              </article>
            )
          })}
          <nav className="flex justify-between">
            {cursor > 0 ? (
              <Link to={pageHref(Math.max(0, cursor - 20))} className="text-sm hover:underline">
                ← Previous
              </Link>
            ) : (
              <span />
            )}
            {results.data.nextCursor !== null ? (
              <Link to={pageHref(results.data.nextCursor)} className="text-sm hover:underline">
                Next →
              </Link>
            ) : (
              <span />
            )}
          </nav>
        </div>
      )}
    </div>
  )
}
