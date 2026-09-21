// Assembles the compact, model-ready text of a thread from the parse/thread
// checkpoints: the opener, a few earliest replies, and a shortlist of quotable
// candidate lines. Shared by the classify (Jev) and enrich (Haiku) stages so
// both see the same trimmed view of a thread. Bodies are cleaned and truncated
// as they stream in — the full 64KB message body is never retained.
import { join } from 'node:path'
import { ThreadRecord, ThreadedMessage, type StageContext } from './types'
import { readJsonl } from './checkpoint'
import { withoutQuotedLines } from './text'

export type ThreadInput = {
  threadKey: string
  subject: string
  startedAt: string
  startedDateOnly: boolean // the thread's start timestamp had no time of day
  messageCount: number
  opener: { messageId: string; text: string; dateOnly: boolean } | null
  // hoursLater is meaningless when either endpoint is dateOnly (~61% of this
  // archive) — consumers switch to daysLater in that case (jev.buildState).
  replies: Array<{ messageId: string; hoursLater: number; daysLater: number; dateOnly: boolean; text: string }>
  candidateLines: Array<{ label: string; messageId: string; text: string }>
}

type CollectOpts = {
  openerChars: number
  replyChars: number
  maxReplies: number
  filter?: (t: ThreadRecord) => boolean
}

// A message retained during the streaming pass: text is already quote-stripped,
// signature-cut, whitespace-collapsed and truncated to the larger of the two
// display limits, so re-truncating per role at the end is a cheap slice.
type Retained = { messageId: string; postedAt: string; dateOnly: boolean; text: string }

type Acc = {
  rootMessageId: string | null
  earliest: Retained[] // ascending by postedAt, capped at maxReplies + 1
  root: Retained | null // the archive root, when its messageId is seen
}

// Quote-strip, cut the signature at the first `-- ` delimiter line, collapse
// horizontal whitespace within each line (line breaks kept), then truncate.
function cleanBody(body: string, limit: number): string {
  const lines: string[] = []
  for (const raw of withoutQuotedLines(body).split('\n')) {
    if (raw === '-- ') break
    lines.push(raw.replace(/[^\S\n]+/g, ' ').trim())
  }
  const collapsed = lines.join('\n').replace(/\n{3,}/g, '\n\n').trim()
  return truncate(collapsed, limit)
}

function truncate(text: string, limit: number): string {
  return text.length > limit ? text.slice(0, limit - 1) + '…' : text
}

function insertEarliest(acc: Acc, item: Retained, cap: number): void {
  let i = acc.earliest.length
  while (i > 0 && acc.earliest[i - 1]!.postedAt > item.postedAt) i--
  acc.earliest.splice(i, 0, item)
  if (acc.earliest.length > cap) acc.earliest.length = cap
}

export async function collectThreadInputs(ctx: StageContext, opts: CollectOpts): Promise<Map<string, ThreadInput>> {
  const retainLimit = Math.max(opts.openerChars, opts.replyChars)
  const cap = opts.maxReplies + 1

  // Pass 1: the threads we keep, with their metadata and archive root id.
  const meta = new Map<string, ThreadRecord>()
  for await (const t of readJsonl(join(ctx.paths.work, 'threads.jsonl'), ThreadRecord)) {
    if (opts.filter && !opts.filter(t)) continue
    meta.set(t.threadKey, t)
  }

  // Pass 2: retain the earliest (maxReplies + 1) messages per kept thread, plus
  // the root message when it is not already among them.
  const accs = new Map<string, Acc>()
  for await (const m of readJsonl(join(ctx.paths.work, 'threaded.jsonl'), ThreadedMessage)) {
    const t = meta.get(m.threadKey)
    if (!t) continue
    let acc = accs.get(m.threadKey)
    if (!acc) {
      acc = { rootMessageId: t.rootMessageId, earliest: [], root: null }
      accs.set(m.threadKey, acc)
    }
    const retained: Retained = {
      messageId: m.messageId,
      postedAt: m.postedAt,
      dateOnly: m.dateOnly,
      text: cleanBody(m.body, retainLimit),
    }
    insertEarliest(acc, retained, cap)
    if (acc.rootMessageId !== null && m.messageId === acc.rootMessageId) acc.root = retained
  }

  const inputs = new Map<string, ThreadInput>()
  for (const [threadKey, t] of meta) {
    const acc = accs.get(threadKey)
    const openerRetained = pickOpener(acc)
    const opener = openerRetained
      ? {
          messageId: openerRetained.messageId,
          text: truncate(openerRetained.text, opts.openerChars),
          dateOnly: openerRetained.dateOnly,
        }
      : null

    const replies: ThreadInput['replies'] = []
    if (acc && openerRetained) {
      const openerMs = Date.parse(openerRetained.postedAt)
      for (const r of acc.earliest) {
        if (r.messageId === openerRetained.messageId) continue
        const hoursLater = Math.round(((Date.parse(r.postedAt) - openerMs) / 3.6e6) * 10) / 10
        replies.push({
          messageId: r.messageId,
          hoursLater,
          daysLater: Math.round(hoursLater / 24),
          dateOnly: r.dateOnly,
          text: truncate(r.text, opts.replyChars),
        })
        if (replies.length >= opts.maxReplies) break
      }
    }

    inputs.set(threadKey, {
      threadKey,
      subject: t.subject,
      startedAt: t.startedAt,
      startedDateOnly: t.startedDateOnly,
      messageCount: t.messageCount,
      opener,
      replies,
      candidateLines: extractCandidateLines(opener, replies),
    })
  }
  return inputs
}

// The archive root when present, else the earliest message by postedAt.
function pickOpener(acc: Acc | undefined): Retained | null {
  if (!acc) return null
  if (acc.root) return acc.root
  return acc.earliest[0] ?? null
}

type Line = { messageId: string; text: string }

export function extractCandidateLines(
  opener: Line | null,
  replies: ReadonlyArray<Line>,
  max = 12,
): Array<{ label: string; messageId: string; text: string }> {
  const out: Array<{ label: string; messageId: string; text: string }> = []
  const seen = new Set<string>()
  const sources: Line[] = opener ? [opener, ...replies] : [...replies]

  for (const src of sources) {
    for (const segment of src.text.split(/\n+/).flatMap((line) => line.split(/(?<=[.!?])\s+/))) {
      const line = segment.trim()
      if (!isQuotable(line)) continue
      const key = line.toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      out.push({ label: `L${out.length + 1}`, messageId: src.messageId, text: line })
      if (out.length >= max) return out
    }
  }
  return out
}

function isQuotable(line: string): boolean {
  if (line.length < 25 || line.length > 240) return false
  if (line.split(/\s+/).filter(Boolean).length < 5) return false
  if (line.includes('@') || line.includes('http')) return false
  if (line.startsWith('On ') && line.includes(' wrote')) return false
  if (/[A-Z]/.test(line) && line === line.toUpperCase()) return false
  return true
}
