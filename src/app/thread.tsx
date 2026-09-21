import { Fragment, type ReactNode, useState } from 'react'
import { Link, useParams, useRouteLoaderData } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useTRPC } from '~/lib/trpc'
import { AdminFixEpisode } from '~/components/admin-fix-episode'
import { Badge } from '~/components/badge'
import { MessageBody } from '~/components/message-body'
import { buildTree, type Node } from '~/lib/thread-tree'
import { KIND, PREDICTION_OUTCOME, SENTIMENT } from '~/lib/taxonomy'
import { episodeCode, formatDateTime, formatNumber, plural, relativeToAir } from '~/lib/format'
import type { RootLoaderData } from './routes'

function countDescendants(node: Node): number {
  return node.children.reduce((sum, child) => sum + 1 + countDescendants(child), 0)
}

function MessageNode({
  node,
  byId,
  depth,
  collapsed,
  toggle,
  showSlug,
}: {
  node: Node
  byId: Map<number, Node>
  depth: number
  collapsed: Set<number>
  toggle: (id: number) => void
  showSlug: string
}) {
  const m = node.message
  const parent = m.parentId === null ? undefined : byId.get(m.parentId)
  const isCollapsed = collapsed.has(m.id)
  const replyCount = countDescendants(node)

  return (
    <article id={`m${m.id}`} className="space-y-1.5 py-3">
      <div className="flex flex-wrap items-baseline gap-x-2 text-sm">
        <Link to={`/${showSlug}/people/${m.poster.id}`} className="font-medium hover:underline">
          {m.poster.displayName}
        </Link>
        <span className="text-muted-foreground">{formatDateTime(m.postedAt, m.dateOnly)}</span>
        {parent && (
          <a href={`#m${m.parentId}`} className="text-muted-foreground hover:underline">
            ↳ in reply to {parent.message.poster.displayName}
          </a>
        )}
        {node.children.length > 0 && (
          <button
            type="button"
            onClick={() => toggle(m.id)}
            className="text-muted-foreground text-xs hover:underline">
            {isCollapsed ? `show ${replyCount} replies` : `collapse ${replyCount} replies`}
          </button>
        )}
      </div>
      <MessageBody body={m.body} />
      {!isCollapsed && node.children.length > 0 && (
        <div className={depth < 6 ? 'ml-3 border-l pl-3 sm:ml-4 sm:pl-4' : undefined}>
          {node.children.map((child) => (
            <MessageNode
              key={child.message.id}
              node={child}
              byId={byId}
              depth={depth + 1}
              collapsed={collapsed}
              toggle={toggle}
              showSlug={showSlug}
            />
          ))}
        </div>
      )}
    </article>
  )
}

export function ThreadPage() {
  const { id } = useParams()
  const trpc = useTRPC()
  const rootData = useRouteLoaderData('root') as RootLoaderData | undefined
  const session = rootData?.session ?? null
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set())

  const threadId = Number(id)
  const threadQuery = useQuery(
    trpc.threads.get.queryOptions(
      { id: threadId },
      { enabled: Number.isInteger(threadId) && threadId > 0 }
    )
  )

  const data = threadQuery.data
  if (!data) return <p className="text-muted-foreground text-sm">Loading…</p>

  const { thread } = data
  const showSlug = thread.showSlug
  const ep = thread.episodes.find((e) => e.isPrimary) ?? null
  const { roots, byId } = buildTree(data.messages)

  function toggle(nodeId: number) {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(nodeId)) next.delete(nodeId)
      else next.add(nodeId)
      return next
    })
  }

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
      <span className="flex items-center gap-1.5">
        <Link to={`/${showSlug}/${ep.slug}`} className="hover:underline">
          {episodeCode(ep.seasonNumber, ep.number)} {ep.title}
        </Link>
        <Badge variant="outline">{ep.relation}</Badge>
      </span>
    )
  }
  metaSegments.push(formatDateTime(thread.startedAt, thread.startedDateOnly))
  if (rel) metaSegments.push(rel)
  metaSegments.push(
    `${plural(thread.messageCount, 'post')} by ${plural(thread.posterCount, 'poster')}`
  )

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="space-y-2">
        <h1 className="text-2xl leading-tight font-bold tracking-tight">{thread.subject}</h1>
        <div className="text-muted-foreground flex flex-wrap gap-x-2 text-sm">
          {metaSegments.map((seg, i) => (
            <Fragment key={i}>
              {i > 0 && <span aria-hidden>·</span>}
              {seg}
            </Fragment>
          ))}
        </div>
        {badges.length > 0 && <div className="flex flex-wrap gap-1.5">{badges}</div>}
        {thread.predictionClaim && <p className="text-sm italic">{thread.predictionClaim}</p>}
        {thread.summary && <p className="text-muted-foreground max-w-[60ch]">{thread.summary}</p>}
        {session && (
          <AdminFixEpisode
            threadId={threadId}
            showSlug={showSlug}
            currentEpisodeSlug={ep?.slug ?? null}
          />
        )}
      </div>

      {data.truncated && (
        <p className="text-muted-foreground text-sm">
          Showing the first {formatNumber(1000)} posts of {formatNumber(thread.messageCount)}.
        </p>
      )}

      <div className="divide-y">
        {roots.map((root) => (
          <MessageNode
            key={root.message.id}
            node={root}
            byId={byId}
            depth={0}
            collapsed={collapsed}
            toggle={toggle}
            showSlug={showSlug}
          />
        ))}
      </div>
    </div>
  )
}
