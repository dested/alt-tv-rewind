import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useTRPC } from '~/lib/trpc'
import type { RouterOutputs } from '~/lib/api-types'
import { compact, formatYear, plural } from '~/lib/format'

type Show = RouterOutputs['shows']['list'][number]

function yearRange(premiered: string | null, ended: string | null): string {
  const from = premiered?.slice(0, 4)
  const to = ended?.slice(0, 4)
  if (from && to) return `${from}–${to}`
  if (from) return `${from}–present`
  return to ?? ''
}

function joinDot(parts: Array<string | null | undefined>): string {
  return parts.filter((p): p is string => Boolean(p)).join(' · ')
}

function statLine(archive: Show['archive']): string {
  if (!archive) return 'not ingested yet'
  const years =
    archive.firstPostAt && archive.lastPostAt
      ? `${formatYear(archive.firstPostAt)}–${formatYear(archive.lastPostAt)}`
      : null
  return joinDot([`${compact(archive.messageCount)} posts`, years, archive.newsgroup])
}

export function HomePage() {
  const trpc = useTRPC()
  const { data: shows } = useQuery(trpc.shows.list.queryOptions())

  if (!shows) return <p className="text-muted-foreground text-sm">Loading…</p>

  return (
    <div className="space-y-12">
      <section className="space-y-3">
        <h1 className="font-serif text-5xl leading-[1.05] font-semibold tracking-tight text-balance">
          What Usenet said the morning after
        </h1>
        <p className="text-muted-foreground max-w-[60ch]">
          Newsgroup reaction to TV episodes, lined up against the night they first aired.
        </p>
      </section>

      {shows.length === 0 ? (
        <p className="text-muted-foreground">
          No shows ingested yet — run <code>bun run pipeline add-show</code>.
        </p>
      ) : (
        <div className="border-t">
          {shows.map((show) => (
            <article key={show.slug} className="grid grid-cols-[4rem_1fr] gap-x-6 border-b py-5">
              {show.imageUrl ? (
                <img src={show.imageUrl} alt="" className="aspect-[2/3] w-16 border object-cover" />
              ) : (
                <div className="bg-secondary aspect-[2/3] w-16 border" />
              )}
              <div className="min-w-0 space-y-1">
                <Link
                  to={`/${show.slug}`}
                  className="hover:text-link block font-serif text-2xl font-medium">
                  {show.name}
                </Link>
                <div className="text-muted-foreground text-sm">
                  {joinDot([
                    yearRange(show.premiered, show.ended),
                    show.network,
                    plural(show.episodeCount, 'episode'),
                  ])}
                </div>
                <div className="text-muted-foreground text-sm tabular-nums">
                  {statLine(show.archive)}
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  )
}
