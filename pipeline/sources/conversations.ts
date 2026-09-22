// Cross-source Usenet conversation threading. Each source is threaded on its own
// with the existing JWZ threader (so a subject-only merge never crosses a
// source), then the per-source threads are unioned into conversations by two
// signals: a shared canonical id (the same post crossposted into two sources)
// and a References/In-Reply-To that resolves into another thread's member.
import { threadMessages } from '../lib/jwz'
import type { ParsedMessage } from '../lib/types'
import type { Conversation } from './types'

// Fixed precedence of the five Usenet sources: earlier wins when the same
// canonical post appears in several sources (it becomes the member's primary
// record; the rest are additionalRecordIds).
export const USENET_SOURCE_ORDER = [
  'usenet-alt-tv-familyguy',
  'usenet-alt-tv-simpsons-itchy-scratchy',
  'usenet-rec-arts-animation',
  'usenet-alt-tv-game-shows',
  'usenet-rec-arts-tv',
] as const

export type SlimRecord = {
  recordId: string
  canonicalId: string
  sourceId: string
  externalId: string
  subject: string
  subjectNorm: string
  fromName: string
  posterKey: string
  postedAt: string | null // resolved instant: noon for day-only, null for unknown
  dateOnly: boolean
  references: string[]
  inReplyTo: string | null
  isSpam: boolean
}

export type ConversationSummary = {
  perSourceThreads: Record<string, number>
  conversations: number
  crossSourceConversations: number
  crosspostMembers: number
  referenceUnions: number
  undatedRecords: number
  missingIdRecords: number
}

function sha256hex(s: string): string {
  return new Bun.CryptoHasher('sha256').update(s).digest('hex')
}

function canonicalOf(messageId: string): string {
  return 'usenet:' + sha256hex(messageId)
}

type Meta = { parentRef: string | null; resolvedPostedAt: string }
type ThreadNode = { sourceId: string; recordIds: string[] }

// A member under construction; subjectNorm is kept for the conversation subject
// but is not part of the persisted member shape.
type Member = {
  recordId: string
  canonicalId: string
  sourceId: string
  additionalRecordIds: string[]
  parentCanonicalId: string | null
  depth: number
  sortAt: string
  inheritedDate: boolean
  subjectNorm: string
}

export function buildConversations(
  records: SlimRecord[],
  log: (s: string) => void
): { conversations: Conversation[]; summary: ConversationSummary } {
  const recordById = new Map<string, SlimRecord>()
  const bySource = new Map<string, SlimRecord[]>()
  let missingIdRecords = 0
  for (const r of records) {
    recordById.set(r.recordId, r)
    if (r.externalId === '') {
      missingIdRecords++
      continue
    }
    const arr = bySource.get(r.sourceId)
    if (arr) arr.push(r)
    else bySource.set(r.sourceId, [r])
  }

  const orderIndex = new Map<string, number>(USENET_SOURCE_ORDER.map((s, i) => [s, i]))
  const sourceRank = (id: string): number => orderIndex.get(id) ?? USENET_SOURCE_ORDER.length
  const sourcesOrdered = [...bySource.keys()].sort((a, b) => sourceRank(a) - sourceRank(b))

  const nodes: ThreadNode[] = []
  const metaByRecord = new Map<string, Meta>()
  const perSourceThreads: Record<string, number> = {}
  const undated: string[] = []

  // (1) Per-source JWZ threading.
  for (const sourceId of sourcesOrdered) {
    const recs = bySource.get(sourceId)
    if (recs === undefined) continue
    const byExt = new Map<string, SlimRecord>()
    for (const r of recs) byExt.set(r.externalId, r)
    const pms: ParsedMessage[] = recs.map((r) => ({
      messageId: r.externalId,
      subject: r.subject,
      subjectNorm: r.subjectNorm,
      fromName: r.fromName,
      posterKey: r.posterKey,
      postedAt: r.postedAt,
      dateOnly: r.dateOnly,
      references: r.references,
      inReplyTo: r.inReplyTo,
      newsgroups: [],
      body: '',
      lineCount: 0,
      isSpam: r.isSpam,
      spamReason: null,
    }))
    const { threaded } = threadMessages(pms)
    const groups = new Map<string, string[]>() // threadKey → recordIds
    const present = new Set<string>()
    for (const tm of threaded) {
      const rec = byExt.get(tm.messageId)
      if (rec === undefined) continue
      present.add(rec.recordId)
      metaByRecord.set(rec.recordId, { parentRef: tm.parentRef, resolvedPostedAt: tm.postedAt })
      const g = groups.get(tm.threadKey)
      if (g) g.push(rec.recordId)
      else groups.set(tm.threadKey, [rec.recordId])
    }
    perSourceThreads[sourceId] = groups.size
    for (const recordIds of groups.values()) nodes.push({ sourceId, recordIds })
    for (const r of recs) if (!present.has(r.recordId)) undated.push(r.recordId) // JWZ dropped: no dated message
  }

  // (2) Union-find over the per-source threads.
  const uf = Array.from({ length: nodes.length }, (_, i) => i)
  const find = (x0: number): number => {
    let x = x0
    for (;;) {
      const p = uf[x]
      if (p === undefined || p === x) return x
      const gp = uf[p]
      if (gp !== undefined) uf[x] = gp
      x = p
    }
  }
  const union = (a: number, b: number): boolean => {
    const ra = find(a)
    const rb = find(b)
    if (ra === rb) return false
    uf[ra] = rb
    return true
  }

  // canonical id → the node that first carried a record with that id.
  const nodeOfCanonical = new Map<string, number>()
  for (const [ni, node] of nodes.entries()) {
    for (const recordId of node.recordIds) {
      const rec = recordById.get(recordId)
      if (rec === undefined) continue
      const existing = nodeOfCanonical.get(rec.canonicalId)
      if (existing === undefined) nodeOfCanonical.set(rec.canonicalId, ni)
      else union(existing, ni) // (a) same canonical in two sources → one conversation
    }
  }

  let referenceUnions = 0
  for (const [ni, node] of nodes.entries()) {
    for (const recordId of node.recordIds) {
      const rec = recordById.get(recordId)
      if (rec === undefined) continue
      const refs = rec.references.length > 0 ? rec.references : rec.inReplyTo !== null ? [rec.inReplyTo] : []
      for (const ref of refs) {
        const other = nodeOfCanonical.get(canonicalOf(ref))
        // (b) a reference that resolves into another thread → one conversation
        if (other !== undefined && find(other) !== find(ni) && union(other, ni)) referenceUnions++
      }
    }
  }

  // (3) Group nodes into conversations, then build members per conversation.
  const convNodes = new Map<number, number[]>()
  for (let i = 0; i < nodes.length; i++) {
    const root = find(i)
    const a = convNodes.get(root)
    if (a) a.push(i)
    else convNodes.set(root, [i])
  }

  const conversations: Conversation[] = []
  let crosspostMembers = 0
  let crossSourceConversations = 0

  for (const nodeIdxs of convNodes.values()) {
    // Records of this conversation, grouped by canonical id (crossposts collapse).
    const byCanonical = new Map<string, SlimRecord[]>()
    for (const ni of nodeIdxs) {
      const node = nodes[ni]
      if (node === undefined) continue
      for (const recordId of node.recordIds) {
        const rec = recordById.get(recordId)
        if (rec === undefined) continue
        const g = byCanonical.get(rec.canonicalId)
        if (g) g.push(rec)
        else byCanonical.set(rec.canonicalId, [rec])
      }
    }

    const members: Member[] = []
    const memberByCanonical = new Map<string, Member>()
    for (const [canonicalId, recs] of byCanonical) {
      recs.sort((a, b) => sourceRank(a.sourceId) - sourceRank(b.sourceId))
      const primary = recs[0]
      if (primary === undefined) continue
      const meta = metaByRecord.get(primary.recordId)
      const sortAt = meta?.resolvedPostedAt ?? primary.postedAt ?? ''
      const member: Member = {
        recordId: primary.recordId,
        canonicalId,
        sourceId: primary.sourceId,
        additionalRecordIds: recs.slice(1).map((r) => r.recordId),
        parentCanonicalId: null,
        depth: 0,
        sortAt,
        inheritedDate: primary.postedAt === null,
        subjectNorm: primary.subjectNorm,
      }
      crosspostMembers += member.additionalRecordIds.length
      members.push(member)
      memberByCanonical.set(canonicalId, member)
    }

    // Parent = the last reference (else In-Reply-To) that resolves to a member.
    for (const member of members) {
      const primary = recordById.get(member.recordId)
      if (primary === undefined) continue
      let parent: string | null = null
      for (let i = primary.references.length - 1; i >= 0; i--) {
        const ref = primary.references[i]
        if (ref === undefined) continue
        const canon = canonicalOf(ref)
        if (canon !== member.canonicalId && memberByCanonical.has(canon)) {
          parent = canon
          break
        }
      }
      if (parent === null && primary.inReplyTo !== null) {
        const canon = canonicalOf(primary.inReplyTo)
        if (canon !== member.canonicalId && memberByCanonical.has(canon)) parent = canon
      }
      member.parentCanonicalId = parent
    }

    // Depth by walking parents, memoized and cycle-safe.
    const depthMemo = new Map<string, number>()
    const depthOf = (canonicalId: string, visiting: Set<string>): number => {
      const cached = depthMemo.get(canonicalId)
      if (cached !== undefined) return cached
      const member = memberByCanonical.get(canonicalId)
      if (member === undefined || member.parentCanonicalId === null) return 0
      if (visiting.has(canonicalId)) return 0
      visiting.add(canonicalId)
      const d = depthOf(member.parentCanonicalId, visiting) + 1
      visiting.delete(canonicalId)
      depthMemo.set(canonicalId, d)
      return d
    }
    for (const member of members) member.depth = depthOf(member.canonicalId, new Set())

    if (members.length === 0) continue

    // Sorted by (sortAt, canonicalId): members[0] is both the earliest and the
    // key member that names the conversation.
    members.sort((a, b) => (a.sortAt < b.sortAt ? -1 : a.sortAt > b.sortAt ? 1 : a.canonicalId < b.canonicalId ? -1 : 1))
    const keyMember = members[0]
    if (keyMember === undefined) continue
    const earliestAt = keyMember.sortAt
    const sources = new Set<string>()
    for (const member of members) {
      sources.add(member.sourceId)
      for (const addId of member.additionalRecordIds) {
        const add = recordById.get(addId)
        if (add !== undefined) sources.add(add.sourceId)
      }
    }

    const sourceList = [...sources].sort((a, b) => sourceRank(a) - sourceRank(b))
    if (sourceList.length > 1) crossSourceConversations++

    conversations.push({
      key: 'c:' + sha256hex(keyMember.canonicalId).slice(0, 16),
      members: members.map((m) => ({
        recordId: m.recordId,
        canonicalId: m.canonicalId,
        sourceId: m.sourceId,
        additionalRecordIds: m.additionalRecordIds,
        parentCanonicalId: m.parentCanonicalId,
        depth: m.depth,
        sortAt: m.sortAt,
        inheritedDate: m.inheritedDate,
      })),
      earliestAt,
      subjectNorm: keyMember.subjectNorm,
      sources: sourceList,
    })
  }

  conversations.sort((a, b) => (a.earliestAt < b.earliestAt ? -1 : a.earliestAt > b.earliestAt ? 1 : a.key < b.key ? -1 : 1))

  const summary: ConversationSummary = {
    perSourceThreads,
    conversations: conversations.length,
    crossSourceConversations,
    crosspostMembers,
    referenceUnions,
    undatedRecords: undated.length,
    missingIdRecords,
  }
  log(
    `conversations: ${conversations.length} (${crossSourceConversations} cross-source, ` +
      `${crosspostMembers} crossposts, ${referenceUnions} reference unions, ${undated.length} undated)`
  )
  return { conversations, summary }
}
