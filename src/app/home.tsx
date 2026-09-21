import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useTRPC } from '~/lib/trpc'
import type { RouterOutputs } from '~/lib/api-types'
import { compact, formatYear } from '~/lib/format'

type Show = RouterOutputs['shows']['list'][number]

function yearRange(premiered: string | null, ended: string | null): string {
  const from = premiered?.slice(0, 4)
  const to = ended?.slice(0, 4)
  if (from && to) return `${from}–${to}`
  return from ?? to ?? ''
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
    <div className="space-y-8">
      <section className="space-y-3">
        <h1 className="text-4xl font-bold tracking-tight">alt.tv.rewind</h1>
        <p className="text-muted-foreground max-w-2xl text-lg">
          What the newsgroups said the morning after — Usenet reaction to TV episodes, lined up
          against the night they first aired.
        </p>
      </section>

      {shows.length === 0 ? (
        <p className="text-muted-foreground">
          No shows ingested yet — run <code>bun run pipeline add-show</code>.
        </p>
      ) : (
        <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {shows.map((show) => (
            <Link
              key={show.slug}
              to={`/${show.slug}`}
              className="bg-card hover:border-foreground/30 block overflow-hidden rounded-lg border transition-colors">
              {show.imageUrl ? (
                <img src={show.imageUrl} alt="" className="aspect-[2/3] w-full object-cover" />
              ) : (
                <div className="bg-secondary aspect-[2/3]" />
              )}
              <div className="space-y-1 p-4">
                <div className="font-semibold">{show.name}</div>
                <div className="text-muted-foreground text-sm">
                  {joinDot([yearRange(show.premiered, show.ended), show.network])}
                </div>
                <div className="text-muted-foreground text-sm tabular-nums">
                  {statLine(show.archive)}
                </div>
              </div>
            </Link>
          ))}
        </section>
      )}
    </div>
  )
}
