// Pure decisions for the Usenet → serving projection (import-usenet.ts). Kept
// DB-free so the branch logic — which legacy thread a conversation joins, how a
// member's parent/depth resolves, how a record's date precision maps to a
// message row, and whether a re-run must insert anything — is unit-testable.
import { daysAfterAir, isLive } from '../lib/timing'
import type { DatePrecision } from './types'

// A row of the show's existing messages (message JOIN archive on show_id). Rows
// whose sourceRecordId is non-null were written by a previous import run.
export type LegacyMessage = {
  id: number
  messageId: string
  threadId: number
  depth: number
  sourceRecordId: number | null
}

// The Message-IDs a conversation would occupy → the legacy thread it joins.
// Most legacy hits wins; ties resolve to the lowest thread id (stable URL).
export function chooseThread(externalIds: Iterable<string>, legacy: Map<string, LegacyMessage>): number | null {
  const counts = new Map<number, number>()
  for (const ext of externalIds) {
    const row = legacy.get(ext)
    if (row === undefined) continue
    counts.set(row.threadId, (counts.get(row.threadId) ?? 0) + 1)
  }
  let best: { id: number; count: number } | null = null
  for (const [threadId, count] of counts) {
    if (best === null || count > best.count || (count === best.count && threadId < best.id)) {
      best = { id: threadId, count }
    }
  }
  return best === null ? null : best.id
}

// What happens to one member of a joined conversation, given the legacy index.
//   'insert'         — no legacy row for its Message-ID; a new message row.
//   'linked'         — a legacy row exists (its source is archive.source); we
//                      only add the additional membership, never a row.
//   'alreadyImported'— a legacy row this same record already produced; idempotent
//                      re-run, no row and no double count.
export type MemberFate = 'insert' | 'linked' | 'alreadyImported'

export function memberFate(externalId: string, recordDbId: number, legacy: Map<string, LegacyMessage>): MemberFate {
  const row = legacy.get(externalId)
  if (row === undefined) return 'insert'
  if (row.sourceRecordId === recordDbId) return 'alreadyImported'
  return 'linked'
}

// A message row's day-resolution state. `dateOnly` hides any hour-based phrase;
// `datePrecision` is 'unknown' for a date the threader inherited from a parent
// (a sort key, not an observed posting time), otherwise the record's own.
export function mapDates(
  recordPrecision: DatePrecision,
  inheritedDate: boolean
): { dateOnly: boolean; datePrecision: DatePrecision } {
  return {
    dateOnly: inheritedDate || recordPrecision === 'day',
    datePrecision: inheritedDate ? 'unknown' : recordPrecision,
  }
}

// A member as the projection needs it for parent/depth resolution.
export type ProjectionMember = {
  externalId: string
  canonicalId: string
  parentCanonicalId: string | null
  references: string[] // oldest → newest, as in the References header
}

// parent_ref + depth for every member being inserted into one thread.
//   parent_ref = the parent member's Message-ID when parentCanonicalId names a
//     member of this conversation, else the newest reference that is a legacy
//     Message-ID already in this thread, else null.
//   depth = (parent's depth) + 1, resolving the parent in memory whether it is a
//     legacy row or another inserted member; 0 when there is no parent.
export function projectThread(
  toInsert: ProjectionMember[],
  externalIdByCanonical: Map<string, string>, // every conversation member: canonical → Message-ID
  legacyDepth: Map<string, number> // legacy rows in the chosen thread: Message-ID → depth
): Map<string, { parentRef: string | null; depth: number }> {
  const memberByExternalId = new Map(toInsert.map((m) => [m.externalId, m]))

  const parentRefOf = (m: ProjectionMember): string | null => {
    if (m.parentCanonicalId !== null) {
      const ext = externalIdByCanonical.get(m.parentCanonicalId)
      if (ext !== undefined && ext !== m.externalId) return ext
    }
    for (let i = m.references.length - 1; i >= 0; i--) {
      const ref = m.references[i]
      if (ref !== undefined && ref !== m.externalId && legacyDepth.has(ref)) return ref
    }
    return null
  }

  const depthMemo = new Map<string, number>()
  const depthOf = (externalId: string, visiting: Set<string>): number => {
    const cached = depthMemo.get(externalId)
    if (cached !== undefined) return cached
    const m = memberByExternalId.get(externalId)
    if (m === undefined) return 0
    const pr = parentRefOf(m)
    let d: number
    if (pr === null) d = 0
    else if (legacyDepth.has(pr)) d = (legacyDepth.get(pr) ?? 0) + 1
    else if (visiting.has(externalId)) d = 0
    else {
      visiting.add(externalId)
      d = depthOf(pr, visiting) + 1
      visiting.delete(externalId)
    }
    depthMemo.set(externalId, d)
    return d
  }

  const out = new Map<string, { parentRef: string | null; depth: number }>()
  for (const m of toInsert) {
    out.set(m.externalId, { parentRef: parentRefOf(m), depth: depthOf(m.externalId, new Set()) })
  }
  return out
}

// Thread relation to an episode on ET calendar days (decisions.md 2026-09-21):
// a thread that started inside the show's live window is a live reaction.
export function threadRelation(
  airDateMs: number,
  threadStartedAtMs: number,
  liveWindowDays: number
): 'live' | 'retro' {
  return isLive(daysAfterAir(airDateMs, threadStartedAtMs), liveWindowDays) ? 'live' : 'retro'
}
