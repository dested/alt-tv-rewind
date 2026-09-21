// JWZ threading (https://www.jwz.org/doc/threading.html) over ParsedMessage
// records. Builds a container forest from References/In-Reply-To, prunes empty
// (phantom) containers, merges same-subject roots within a 30-day window, then
// emits one record per thread and per message.
import type { ParsedMessage, ThreadRecord, ThreadedMessage } from './types'

type Container = {
  id: string
  message: ParsedMessage | null
  parent: Container | null
  children: Container[]
}

const DAY_MS = 86400000

function isAncestorOrSelf(anc: Container, node: Container): boolean {
  let cur: Container | null = node
  while (cur !== null) {
    if (cur === anc) return true
    cur = cur.parent
  }
  return false
}

// Link parent→child, respecting an existing parent (References-chain linking).
function link(parent: Container, child: Container): void {
  if (parent === child || child.parent !== null) return
  if (isAncestorOrSelf(child, parent)) return // would create a loop
  child.parent = parent
  parent.children.push(child)
}

// Re-parent child under parent, overriding a previously presumed parent
// (a message's own References are authoritative for its parent).
function reparent(child: Container, parent: Container): void {
  if (parent === child || child.parent === parent) return
  if (isAncestorOrSelf(child, parent)) return
  if (child.parent !== null) {
    child.parent.children = child.parent.children.filter((c) => c !== child)
  }
  child.parent = parent
  parent.children.push(child)
}

function collectMessages(c: Container, out: ParsedMessage[]): void {
  if (c.message !== null) out.push(c.message)
  for (const ch of c.children) collectMessages(ch, out)
}

function earliestDate(msgs: ParsedMessage[]): string | null {
  let min: string | null = null
  for (const m of msgs) {
    if (m.postedAt === null) continue
    if (min === null || m.postedAt < min) min = m.postedAt
  }
  return min
}

function earliestDatedMessage(msgs: ParsedMessage[]): ParsedMessage | null {
  let best: ParsedMessage | null = null
  let bestDate: string | null = null
  for (const m of msgs) {
    if (m.postedAt === null) continue
    if (bestDate === null || m.postedAt < bestDate) {
      best = m
      bestDate = m.postedAt
    }
  }
  return best
}

// Recursively drop phantom leaves, splice out single-child phantoms and non-root
// multi-child phantoms; keep a phantom root with ≥2 children as a phantom root.
function pruneChildren(parent: Container | null, list: Container[]): Container[] {
  const result: Container[] = []
  for (const child of list) {
    child.children = pruneChildren(child, child.children)
    if (child.message !== null) {
      result.push(child)
      continue
    }
    if (child.children.length === 0) continue // phantom leaf
    const atRoot = parent === null
    if (atRoot && child.children.length > 1) {
      result.push(child) // phantom root
    } else {
      for (const gc of child.children) {
        gc.parent = parent
        result.push(gc)
      }
    }
  }
  return result
}

type Emitted = {
  message: ParsedMessage
  parentRef: string | null
  depth: number
  resolvedPostedAt: string
}

function walk(
  c: Container,
  depth: number,
  parentResolved: string | null,
  threadEarliest: string,
  out: Emitted[]
): void {
  let myResolved = parentResolved
  let childDepth = depth
  if (c.message !== null) {
    const resolved = c.message.postedAt ?? parentResolved ?? threadEarliest
    const parentRef = c.parent !== null && c.parent.message !== null ? c.parent.message.messageId : null
    out.push({ message: c.message, parentRef, depth, resolvedPostedAt: resolved })
    myResolved = resolved
    childDepth = depth + 1
  }
  for (const ch of c.children) walk(ch, childDepth, myResolved, threadEarliest, out)
}

export function threadMessages(messages: ParsedMessage[]): {
  threads: ThreadRecord[]
  threaded: ThreadedMessage[]
  summary: { threads: number; phantomRoots: number; subjectMerges: number; droppedNoDate: number; dupes: number }
} {
  // (1) dedupe by messageId
  const seen = new Set<string>()
  const deduped: ParsedMessage[] = []
  let dupes = 0
  for (const m of messages) {
    if (seen.has(m.messageId)) {
      dupes++
      continue
    }
    seen.add(m.messageId)
    deduped.push(m)
  }

  // (2) build containers
  const containers = new Map<string, Container>()
  const ensure = (id: string): Container => {
    let c = containers.get(id)
    if (c === undefined) {
      c = { id, message: null, parent: null, children: [] }
      containers.set(id, c)
    }
    return c
  }

  for (const m of deduped) ensure(m.messageId).message = m

  for (const m of deduped) {
    const self = ensure(m.messageId)
    const refs = m.references.length > 0 ? m.references : m.inReplyTo !== null ? [m.inReplyTo] : []
    for (let i = 0; i < refs.length - 1; i++) {
      const a = refs[i]
      const b = refs[i + 1]
      if (a === undefined || b === undefined) continue
      link(ensure(a), ensure(b))
    }
    const lastRef = refs[refs.length - 1]
    if (lastRef !== undefined) reparent(self, ensure(lastRef))
  }

  // (3) roots + (4) prune
  const rawRoots: Container[] = []
  for (const c of containers.values()) if (c.parent === null) rawRoots.push(c)
  const roots = pruneChildren(null, rawRoots)

  // (5) subject merge
  type RootInfo = { root: Container; earliest: string | null; subjectNorm: string }
  const finalRoots: Container[] = []
  const groups = new Map<string, RootInfo[]>()
  for (const root of roots) {
    const msgs: ParsedMessage[] = []
    collectMessages(root, msgs)
    const earliest = earliestDate(msgs)
    const anchorMsg = root.message ?? earliestDatedMessage(msgs)
    const subjectNorm = anchorMsg?.subjectNorm ?? ''
    if (subjectNorm === '') {
      finalRoots.push(root)
      continue
    }
    const info: RootInfo = { root, earliest, subjectNorm }
    const g = groups.get(subjectNorm)
    if (g) g.push(info)
    else groups.set(subjectNorm, [info])
  }

  let subjectMerges = 0
  for (const group of groups.values()) {
    group.sort((a, b) => {
      if (a.earliest === null && b.earliest === null) return 0
      if (a.earliest === null) return 1
      if (b.earliest === null) return -1
      return a.earliest < b.earliest ? -1 : a.earliest > b.earliest ? 1 : 0
    })
    let anchor = group[0]
    if (anchor === undefined) continue
    finalRoots.push(anchor.root)
    for (let i = 1; i < group.length; i++) {
      const r = group[i]
      if (r === undefined) continue
      const within =
        anchor.earliest !== null &&
        r.earliest !== null &&
        Math.abs(Date.parse(r.earliest) - Date.parse(anchor.earliest)) <= 30 * DAY_MS
      if (within) {
        r.root.parent = anchor.root
        anchor.root.children.push(r.root)
        subjectMerges++
      } else {
        anchor = r
        finalRoots.push(r.root)
      }
    }
  }

  // (6) emit
  type Build = {
    root: Container
    msgs: ParsedMessage[]
    startedAt: string
    lastPostAt: string
    emitted: Emitted[]
    anchorMsg: ParsedMessage
  }
  const builds: Build[] = []
  let droppedNoDate = 0
  for (const root of finalRoots) {
    const msgs: ParsedMessage[] = []
    collectMessages(root, msgs)
    if (msgs.length === 0) continue
    const startedAt = earliestDate(msgs)
    if (startedAt === null) {
      droppedNoDate += msgs.length
      continue
    }
    let lastPostAt = startedAt
    for (const m of msgs) if (m.postedAt !== null && m.postedAt > lastPostAt) lastPostAt = m.postedAt
    const anchorMsg = root.message ?? earliestDatedMessage(msgs)
    if (anchorMsg === null) continue
    const emitted: Emitted[] = []
    walk(root, 0, null, startedAt, emitted)
    builds.push({ root, msgs, startedAt, lastPostAt, emitted, anchorMsg })
  }

  builds.sort((a, b) => (a.startedAt < b.startedAt ? -1 : a.startedAt > b.startedAt ? 1 : 0))

  const threads: ThreadRecord[] = []
  const threaded: ThreadedMessage[] = []
  let phantomRoots = 0
  builds.forEach((b, index) => {
    const threadKey = `t${index}`
    if (b.root.message === null) phantomRoots++
    const posters = new Set(b.msgs.map((m) => m.posterKey))
    let maxDepth = 0
    for (const e of b.emitted) if (e.depth > maxDepth) maxDepth = e.depth
    threads.push({
      threadKey,
      rootMessageId: b.root.message !== null ? b.root.id : null,
      subject: b.anchorMsg.subject,
      subjectNorm: b.anchorMsg.subjectNorm,
      startedAt: b.startedAt,
      startedDateOnly: earliestDatedMessage(b.msgs)?.dateOnly ?? true,
      lastPostAt: b.lastPostAt,
      messageCount: b.msgs.length,
      posterCount: posters.size,
      maxDepth,
      isSpam: b.anchorMsg.isSpam,
    })
    const sorted = [...b.emitted].sort((x, y) =>
      x.resolvedPostedAt < y.resolvedPostedAt ? -1 : x.resolvedPostedAt > y.resolvedPostedAt ? 1 : 0
    )
    for (const e of sorted) {
      threaded.push({
        ...e.message,
        threadKey,
        parentRef: e.parentRef,
        depth: e.depth,
        postedAt: e.resolvedPostedAt,
        // An inherited date is only as precise as its source, never more.
        dateOnly: e.message.postedAt === null ? true : e.message.dateOnly,
      })
    }
  })

  return {
    threads,
    threaded,
    summary: { threads: threads.length, phantomRoots, subjectMerges, droppedNoDate, dupes },
  }
}
