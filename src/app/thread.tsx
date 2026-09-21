import { Fragment, type ReactNode, useState } from 'react'
import { Link, useParams, useRouteLoaderData } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useTRPC } from '~/lib/trpc'
import { AdminFixEpisode } from '~/components/admin-fix-episode'
import { Avatar } from '~/components/avatar'
import { Badge } from '~/components/badge'
import { MessageBody } from '~/components/message-body'
import { buildTree, type Node } from '~/lib/thread-tree'
import { KIND, PREDICTION_OUTCOME, SENTIMENT } from '~/lib/taxonomy'
import { episodeCode, formatDateTime, formatNumber, plural, relativeToAir } from '~/lib/format'
import { stripRe } from '~/lib/usenet'
import type { RootLoaderData } from './routes'

function countDescendants(node: Node): number {
  return node.children.reduce((sum, child) => sum + 1 + countDescendants(child), 0)
}

// Indent rail for a node's children. Caps visual depth at 4 on ≥sm, 2 below;
// deeper replies flatten and rely on the "↩ name" link.
function childRail(depth: number): string {
  if (depth < 2) return 'ml-[1.125rem] border-l pl-[1.875rem]'
  if (depth < 4) return 'sm:ml-[1.125rem] sm:border-l sm:pl-[1.875rem]'
  return ''
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
    <article id={`m${m.id}`} className="grid grid-cols-[2.25rem_1fr] gap-x-3 py-5">
      <Avatar name={m.poster.displayName} />
      <div className="min-w-0">
        <div className="flex flex-wrap items-baseline gap-x-2 text-sm">
          <Link to={`/${showSlug}/people/${m.poster.id}`} className="font-medium hover:underline">
            {m.poster.displayName}
          </Link>
          <time className="text-muted-foreground text-xs">
            {formatDateTime(m.postedAt, m.dateOnly)}
          </time>
          {parent && (
            <a href={`#m${m.parentId}`} className="text-muted-foreground text-xs hover:underline">
              ↩ {parent.message.poster.displayName}
            </a>
          )}
          {node.children.length > 0 && (
            <button
              type="button"
              onClick={() => toggle(m.id)}
              className="text-muted-foreground hover:text-foreground ml-auto text-xs">
              {isCollapsed
                ? `show ${plural(replyCount, 'reply', 'replies')}`
                : `collapse ${plural(replyCount, 'reply', 'replies')}`}
            </button>
          )}
        </div>
        <div className="mt-1.5">
          <MessageBody body={m.body} />
        </div>
        {!isCollapsed && node.children.length > 0 && (
          <div className={childRail(depth)}>
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
      </div>
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
      <Link
        to={`/${showSlug}/${ep.slug}`}
        className="hover:border-foreground/40 inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs">
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
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="space-y-3">
        <h1 className="font-serif text-3xl leading-tight font-semibold tracking-tight text-balance">
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
        {thread.predictionClaim && (
          <p className="font-serif text-sm italic">{thread.predictionClaim}</p>
        )}
        {thread.summary && (
          <p className="text-muted-foreground max-w-[68ch] text-sm">{thread.summary}</p>
        )}
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
