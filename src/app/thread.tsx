import { Fragment, useState, type ReactNode } from 'react'
import { Link, useParams, useRouteLoaderData, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useTRPC } from '~/lib/trpc'
import { AdminFixEpisode } from '~/components/admin-fix-episode'
import { Avatar } from '~/components/avatar'
import { Badge } from '~/components/badge'
import { MessageBody } from '~/components/message-body'
import { SourceLine } from '~/components/source-line'
import { buildTree, type Node } from '~/lib/thread-tree'
import { KIND, PREDICTION_OUTCOME, SENTIMENT } from '~/lib/taxonomy'
import { episodeCode, formatDateTime, formatNumber, plural, relativeToAir } from '~/lib/format'
import { stripRe, threadOrder } from '~/lib/usenet'
import { cn } from '~/lib/utils'
import type { RootLoaderData } from './routes'

// Deeper replies stop indenting but keep their reply order (see ui.md "Thread").
const MAX_INDENT_DEPTH = 6

type Timing = 'before' | 'live' | 'later' | 'unknown' | null

// A short note next to a post's source when its own timing disagrees with the
// thread's — so a later reply in a premiere thread is never read as a live take.
function timingLabel(timing: Timing, primaryRelation: 'live' | 'retro' | null): string | null {
  if (timing === 'before') return 'before it aired'
  if (timing === 'unknown') return 'date inherited'
  if (timing === 'later' && primaryRelation === 'live') return 'later reply'
  return null
}

function descendantCount(node: Node): number {
  let count = 0
  for (const child of node.children) count += 1 + descendantCount(child)
  return count
}

export function ThreadPage() {
  const { show, slug } = useParams()
  const trpc = useTRPC()
  const rootData = useRouteLoaderData('root') as RootLoaderData | undefined
  const session = rootData?.session ?? null
  const [params, setParams] = useSearchParams()
  // The chosen view rides a URL param so SSR and the first client render agree —
  // no hydration flip and the choice is shareable.
  const view: 'transcript' | 'tree' = params.get('view') === 'tree' ? 'tree' : 'transcript'
  // Collapse state lives here so switching views keeps it.
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set())

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
  const communities =
    thread.sources.length > 1 ? `${thread.sources.length} communities` : (thread.source?.name ?? null)
  if (communities) metaSegments.push(communities)

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

      <div className="border-rule mt-8 flex items-center justify-between border-t-[1.5px] pt-3">
        <span className="text-muted-foreground text-sm">{plural(thread.messageCount, 'post')}</span>
        <div role="tablist" className="flex gap-1.5">
          <button
            type="button"
            role="tab"
            aria-selected={view === 'transcript'}
            onClick={() => changeView('transcript')}
            className={cn(
              'rounded-full px-3 py-1 text-sm transition-colors',
              view === 'transcript'
                ? 'bg-foreground text-background'
                : 'text-muted-foreground hover:bg-secondary hover:text-foreground'
            )}>
            Transcript
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={view === 'tree'}
            onClick={() => changeView('tree')}
            className={cn(
              'rounded-full px-3 py-1 text-sm transition-colors',
              view === 'tree'
                ? 'bg-foreground text-background'
                : 'text-muted-foreground hover:bg-secondary hover:text-foreground'
            )}>
            Reply chains
          </button>
        </div>
      </div>
      <div className="mt-3">
        {view === 'tree' ? (
          <TreeView
            roots={roots}
            collapsed={collapsed}
            toggle={toggle}
            showSlug={showSlug}
            primaryRelation={ep?.relation ?? null}
          />
        ) : (
          <TranscriptView
            ordered={ordered}
            byId={byId}
            showSlug={showSlug}
            primaryRelation={ep?.relation ?? null}
          />
        )}
      </div>
    </div>
  )

  function changeView(next: 'transcript' | 'tree') {
    setParams(
      (prev) => {
        const p = new URLSearchParams(prev)
        if (next === 'transcript') p.delete('view')
        else p.set('view', 'tree')
        return p
      },
      { replace: true, preventScrollReset: true }
    )
  }

  function toggle(id: number) {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }
}

function TranscriptView({
  ordered,
  byId,
  showSlug,
  primaryRelation,
}: {
  ordered: Node[]
  byId: Map<number, Node>
  showSlug: string
  primaryRelation: 'live' | 'retro' | null
}) {
  return (
    <>
      {ordered.map((node) => {
        const m = node.message
        const parent = m.parentId === null ? undefined : byId.get(m.parentId)
        const tLabel = timingLabel(m.timing, primaryRelation)
        return (
          <article
            key={m.id}
            id={`m${m.id}`}
            className="grid gap-x-6 gap-y-2 border-b py-6 last:border-b-0 sm:grid-cols-[11rem_1fr]">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 sm:block sm:text-right">
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
              <SourceLine
                compact
                location={m.location}
                additionalSourceCount={m.additionalSourceCount}
                className="sm:block"
              />
              {tLabel && <span className="text-muted-foreground text-xs sm:block">{tLabel}</span>}
            </div>
            <div className="min-w-0">
              <MessageBody body={m.body} />
            </div>
          </article>
        )
      })}
    </>
  )
}

function TreeView({
  roots,
  collapsed,
  toggle,
  showSlug,
  primaryRelation,
}: {
  roots: Node[]
  collapsed: Set<number>
  toggle: (id: number) => void
  showSlug: string
  primaryRelation: 'live' | 'retro' | null
}) {
  return (
    <>
      {roots.map((node) => (
        <TreeNode
          key={node.message.id}
          node={node}
          depth={0}
          collapsed={collapsed}
          toggle={toggle}
          showSlug={showSlug}
          primaryRelation={primaryRelation}
        />
      ))}
    </>
  )
}

function TreeNode({
  node,
  depth,
  collapsed,
  toggle,
  showSlug,
  primaryRelation,
}: {
  node: Node
  depth: number
  collapsed: Set<number>
  toggle: (id: number) => void
  showSlug: string
  primaryRelation: 'live' | 'retro' | null
}) {
  const m = node.message
  const isCollapsed = collapsed.has(m.id)
  const tLabel = timingLabel(m.timing, primaryRelation)
  return (
    <article id={`m${m.id}`} className="py-4">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <Avatar name={m.poster.displayName} size={22} />
        <Link
          to={`/${showSlug}/people/${m.poster.id}`}
          className="text-link text-sm font-semibold hover:underline">
          {m.poster.displayName}
        </Link>
        <time className="text-muted-foreground text-xs">
          {formatDateTime(m.postedAt, m.dateOnly)}
        </time>
        {node.children.length > 0 && (
          <button
            type="button"
            onClick={() => toggle(m.id)}
            className="text-link text-xs"
            aria-expanded={!isCollapsed}>
            {isCollapsed ? `+ ${plural(descendantCount(node), 'reply')}` : '− collapse'}
          </button>
        )}
        <SourceLine
          compact
          location={m.location}
          additionalSourceCount={m.additionalSourceCount}
        />
        {tLabel && <span className="text-muted-foreground text-xs">{tLabel}</span>}
      </div>
      <div className="mt-1.5 min-w-0">
        <MessageBody body={m.body} />
      </div>
      {!isCollapsed && node.children.length > 0 && (
        <div
          className={
            depth < MAX_INDENT_DEPTH ? 'border-border mt-1 ml-[0.6875rem] border-l pl-5' : 'mt-1'
          }>
          {node.children.map((child) => (
            <TreeNode
              key={child.message.id}
              node={child}
              depth={depth + 1}
              collapsed={collapsed}
              toggle={toggle}
              showSlug={showSlug}
              primaryRelation={primaryRelation}
            />
          ))}
        </div>
      )}
    </article>
  )
}
