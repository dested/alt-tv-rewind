import { Fragment, type ReactNode } from 'react'
import { Link, useParams, useRouteLoaderData } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useTRPC } from '~/lib/trpc'
import { AdminFixEpisode } from '~/components/admin-fix-episode'
import { Avatar } from '~/components/avatar'
import { Badge } from '~/components/badge'
import { MessageBody } from '~/components/message-body'
import { buildTree } from '~/lib/thread-tree'
import { KIND, PREDICTION_OUTCOME, SENTIMENT } from '~/lib/taxonomy'
import { episodeCode, formatDateTime, formatNumber, plural, relativeToAir } from '~/lib/format'
import { stripRe, threadOrder } from '~/lib/usenet'
import type { RootLoaderData } from './routes'

export function ThreadPage() {
  const { show, slug } = useParams()
  const trpc = useTRPC()
  const rootData = useRouteLoaderData('root') as RootLoaderData | undefined
  const session = rootData?.session ?? null

  const threadQuery = useQuery(
    trpc.threads.get.queryOptions(
      { show: show ?? '', slug: slug ?? '' },
      { enabled: Boolean(show && slug) }
    )
  )

  const data = threadQuery.data
  if (!data) return <p className="text-muted-foreground text-sm">Loading…</p>

  const { thread } = data
  const showSlug = thread.showSlug
  const ep = thread.episodes.find((e) => e.isPrimary) ?? null
  const { roots, byId } = buildTree(data.messages)
  // Flat, depth-first: the reply relationship is carried by the "↩ name" gutter
  // link, never by indentation (see ui.md "Thread").
  const ordered = threadOrder(roots)

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

  const rel = relativeToAir(thread.hoursAfterAir, thread.daysAfterAir, thread.startedAt)
  const metaSegments: ReactNode[] = []
  if (ep) {
    metaSegments.push(
      <Link
        to={`/${showSlug}/${ep.slug}`}
        className="text-link hover:bg-link-soft inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs">
        {episodeCode(ep.seasonNumber, ep.number)} {ep.title}
        <span className="text-muted-foreground">{ep.relation}</span>
      </Link>
    )
  }
  metaSegments.push(formatDateTime(thread.startedAt, thread.startedDateOnly))
  if (rel) metaSegments.push(rel)
  metaSegments.push(
    `${plural(thread.messageCount, 'post')} by ${plural(thread.posterCount, 'poster')}`
  )

  return (
    <div className="mx-auto max-w-3xl">
      <div className="space-y-3">
        <h1 className="font-serif text-4xl leading-[1.1] font-semibold tracking-tight text-balance">
          {stripRe(thread.subject)}
        </h1>
        <div className="text-muted-foreground flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
          {metaSegments.map((seg, i) => (
            <Fragment key={i}>
              {i > 0 && <span aria-hidden>·</span>}
              {seg}
            </Fragment>
          ))}
        </div>
        {badges.length > 0 && <div className="flex flex-wrap gap-1.5">{badges}</div>}
        {thread.predictionClaim && <p className="font-serif italic">{thread.predictionClaim}</p>}
        {thread.summary && (
          <p className="text-muted-foreground max-w-[66ch] text-sm">{thread.summary}</p>
        )}
        {session && (
          <AdminFixEpisode
            threadId={thread.id}
            threadSlug={thread.slug}
            showSlug={showSlug}
            currentEpisodeSlug={ep?.slug ?? null}
          />
        )}
      </div>

      {data.truncated && (
        <p className="text-muted-foreground mt-6 text-sm">
          Showing the first {formatNumber(1000)} posts of {formatNumber(thread.messageCount)}.
        </p>
      )}

      <div className="border-rule mt-8 border-t-[1.5px]">
        {ordered.map((node) => {
          const m = node.message
          const parent = m.parentId === null ? undefined : byId.get(m.parentId)
          return (
            <article
              key={m.id}
              id={`m${m.id}`}
              className="grid gap-x-6 gap-y-2 border-b py-6 last:border-b-0 sm:grid-cols-[11rem_1fr]">
              <div className="flex items-center gap-2 sm:block sm:text-right">
                <span className="sm:mb-1.5 sm:ml-auto sm:block">
                  <Avatar name={m.poster.displayName} size={28} />
                </span>
                <Link
                  to={`/${showSlug}/people/${m.poster.id}`}
                  className="text-link text-sm font-semibold hover:underline">
                  {m.poster.displayName}
                </Link>
                <time className="text-muted-foreground text-xs sm:block">
                  {formatDateTime(m.postedAt, m.dateOnly)}
                </time>
                {parent && (
                  <a href={`#m${m.parentId}`} className="text-link text-xs sm:block">
                    ↩ {parent.message.poster.displayName}
                  </a>
                )}
              </div>
              <div className="min-w-0">
                <MessageBody body={m.body} />
              </div>
            </article>
          )
        })}
      </div>
    </div>
  )
}
