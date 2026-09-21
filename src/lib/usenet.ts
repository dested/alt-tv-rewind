// Pure Usenet message parser. Turns a raw body into structured blocks that
// `MessageBody` renders as prose (see ui.md "Message rendering"). No React, no
// DOM, no dates — deterministic so SSR and client agree.

export type Block =
  | { type: 'paragraph'; text: string }
  | { type: 'list'; items: string[] }
  | { type: 'pre'; text: string }
  | { type: 'quote'; attribution: string | null; depth: number; lineCount: number; blocks: Block[] }
  | { type: 'signature'; lines: string[] }

// --- redaction ------------------------------------------------------------

// Message-IDs are removed first: an email pass would otherwise turn `<a@b.c>`
// into `<[email]>`, which the Message-ID pattern no longer matches.
const MESSAGE_ID = /<[^\s<>]+@[^\s<>]+>/g
const EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g
const BANG_PATH = /\b(?:\w[\w.-]*!)+\w[\w.-]*/g

function redactSubstitutions(text: string): string {
  return text.replace(MESSAGE_ID, '').replace(EMAIL, '[email]').replace(BANG_PATH, '[address]')
}

export function redact(text: string): string {
  return redactSubstitutions(text).replace(/ {2,}/g, ' ')
}

// Preformatted text keeps its alignment, so it gets the substitutions but not
// the space collapse (ui.md: pre whitespace is preserved exactly).
function redactPre(text: string): string {
  return redactSubstitutions(text)
}

// --- small helpers --------------------------------------------------------

export function posterHue(name: string): number {
  const s = name.toLowerCase()
  let h = 0x811c9dc5 // FNV-1a 32-bit
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0) % 360
}

export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean)
  const letters = words
    .slice(0, 2)
    .map((w) => w[0] ?? '')
    .join('')
  return letters ? letters.toUpperCase() : '?'
}

export function stripRe(subject: string): string {
  return subject.replace(/^(?:\s*(?:re|fwd?|aw)\s*:\s*)+/i, '')
}

// --- signature ------------------------------------------------------------

const EMAIL_TEST = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/
const URL_TEST = /(?:https?:\/\/|ftp:\/\/|www\.)/i
const PHONE_TEST = /\(?\d{3}\)?[-. ]\d{3}[-. ]\d{4}/

// A rule line: only rule characters (≥6 long) and at least 6 of the same char.
function isRuleLine(line: string): boolean {
  if (!/^[\s*\-=_~#+.]{6,}$/.test(line)) return false
  const counts = new Map<string, number>()
  for (const ch of line) {
    if (ch === ' ' || ch === '\t') continue
    counts.set(ch, (counts.get(ch) ?? 0) + 1)
  }
  for (const c of counts.values()) if (c >= 6) return true
  return false
}

function isSignatureSignal(line: string): boolean {
  return EMAIL_TEST.test(line) || URL_TEST.test(line) || PHONE_TEST.test(line) || isRuleLine(line)
}

function cleanSignature(lines: string[]): string[] {
  const out: string[] = []
  for (const raw of lines) {
    if (isRuleLine(raw)) continue
    const red = redact(raw)
    if (red.trim() === '') continue
    out.push(red)
    if (out.length === 4) break
  }
  return out
}

function splitSignature(lines: string[]): { bodyLines: string[]; signature: Block | null } {
  let sigLines: string[] | null = null
  let bodyLines = lines

  let delimIndex = -1
  for (let i = 0; i < lines.length; i++) {
    if (/^--\s?$/.test(lines[i]!)) {
      delimIndex = i
      break
    }
  }

  if (delimIndex !== -1) {
    sigLines = lines.slice(delimIndex + 1)
    bodyLines = lines.slice(0, delimIndex)
  } else {
    let lastBlank = -1
    for (let i = lines.length - 1; i >= 0; i--) {
      if (lines[i]!.trim() === '') {
        lastBlank = i
        break
      }
    }
    const run = lines.slice(lastBlank + 1)
    if (run.length > 0 && run.length <= 6 && run.some(isSignatureSignal)) {
      sigLines = run
      bodyLines = lines.slice(0, lastBlank + 1)
    }
  }

  if (sigLines === null) return { bodyLines, signature: null }
  const cleaned = cleanSignature(sigLines)
  if (cleaned.length === 0) return { bodyLines, signature: null }
  return { bodyLines, signature: { type: 'signature', lines: cleaned } }
}

// --- attribution ----------------------------------------------------------

const SNIP = /^\s*(?:\.\.\.|\[\.\.\.\]|<snip>|\[snip\]|\[snipped\])\s*$/i
const VERB = '(?:writes|wrote|said|says|posted)'
const ATTR_PAREN = new RegExp(`\\(([^()]{2,60})\\)\\s*${VERB}\\s*:?\\s*$`, 'i')
const ATTR_INLINE = new RegExp(
  `^(?:In (?:article|message) <[^>]*>,?\\s*)?(?:On .*?,\\s*)?(?:"?([^<>"@]{2,60}?)"?)\\s*(?:<[^>]*>)?\\s*${VERB}\\s*:?\\s*$`,
  'i'
)
const VERB_ONLY = new RegExp(`^${VERB}\\s*:?\\s*$`, 'i')

// Resolve an attribution string to a human name, or null if it is empty or
// still address-shaped after redaction.
function normalizeAttribution(name: string): string | null {
  const red = redact(name).trim()
  if (red === '' || red.includes('@') || red.includes('!')) return null
  return red
}

function matchAttribution(line: string): string | null {
  const paren = line.match(ATTR_PAREN)
  if (paren) return paren[1] ?? null
  const inline = line.match(ATTR_INLINE)
  if (inline && inline[1] !== undefined) return inline[1]
  return null
}

// Peel the attribution (and any consumed snip/attribution lines) off the tail
// of the pending run that immediately precedes a quote.
function extractAttribution(buffer: string[]): { attribution: string | null; remaining: string[] } {
  const lines = [...buffer]
  let consumed = false

  if (lines.length > 0 && SNIP.test(lines[lines.length - 1]!)) {
    lines.pop()
    consumed = true
  }

  if (lines.length > 0) {
    const single = matchAttribution(lines[lines.length - 1]!)
    if (single !== null) {
      lines.pop()
      return { attribution: normalizeAttribution(single), remaining: lines }
    }
    // Wrapped form: the name on one line, `wrote:` on the next.
    if (lines.length >= 2 && VERB_ONLY.test(lines[lines.length - 1]!)) {
      const name = lines[lines.length - 2]!.trim()
      if (name.length >= 2 && name.length <= 60 && !/[<>@]/.test(name)) {
        lines.pop()
        lines.pop()
        return { attribution: normalizeAttribution(name), remaining: lines }
      }
    }
  }

  return { attribution: null, remaining: consumed ? lines : buffer }
}

// --- runs: pre / list / paragraph -----------------------------------------

function isPreformatted(lines: string[]): boolean {
  const indented = lines.filter((l) => /^(?: {3,}|\t)/.test(l)).length
  if (indented >= 2) return true
  const internal = lines.filter((l) => /\S {3,}/.test(l)).length
  if (internal >= 2) return true
  const chars = lines.join('\n').replace(/\s/g, '')
  if (chars.length > 0) {
    const nonAlnum = (chars.match(/[^a-zA-Z0-9]/g) ?? []).length
    if (nonAlnum / chars.length >= 0.4) return true
  }
  return false
}

const MARKER = /^(\s*)(?:[-*•]|\d{1,2}[.)])\s+(.*)$/

function tryList(lines: string[]): Block | null {
  if (lines.length === 0 || !MARKER.test(lines[0]!)) return null
  const items: string[] = []
  for (const line of lines) {
    const m = line.match(MARKER)
    if (m) {
      items.push(m[2]!.trim())
    } else if (/^\s+\S/.test(line) && items.length > 0) {
      items[items.length - 1] = `${items[items.length - 1]} ${line.trim()}`
    } else {
      return null
    }
  }
  return { type: 'list', items: items.map((it) => redact(it)) }
}

function flushRun(lines: string[], blocks: Block[]): void {
  if (lines.length === 0) return
  if (isPreformatted(lines)) {
    blocks.push({ type: 'pre', text: lines.map(redactPre).join('\n') })
    return
  }
  const list = tryList(lines)
  if (list) {
    blocks.push(list)
    return
  }
  const text = lines.join(' ').replace(/\s+/g, ' ').trim()
  blocks.push({ type: 'paragraph', text: redact(text) })
}

// --- quotes ---------------------------------------------------------------

const QUOTE_LINE = /^\s{0,3}(?:>[ ]?)+/
const STRIP_ONE = /^(\s{0,3})>[ ]?/
const STRIP_ALL = /^(\s{0,3})(?:>[ ]?)+/

function makeQuote(src: string[], nesting: number, attribution: string | null): Block {
  const depth = nesting + 1
  // Cap nesting at 3: at depth 3 strip every remaining marker so the contents
  // render as plain text rather than deeper chips.
  const stripped =
    depth >= 3 ? src.map((l) => l.replace(STRIP_ALL, '')) : src.map((l) => l.replace(STRIP_ONE, ''))
  return {
    type: 'quote',
    attribution,
    depth,
    lineCount: src.length,
    blocks: parseBlocks(stripped, depth),
  }
}

function parseBlocks(lines: string[], nesting: number): Block[] {
  const blocks: Block[] = []
  let buffer: string[] = []
  let i = 0

  while (i < lines.length) {
    const line = lines[i]!
    if (line.trim() === '') {
      flushRun(buffer, blocks)
      buffer = []
      i++
      continue
    }
    if (QUOTE_LINE.test(line)) {
      let j = i
      while (j < lines.length && QUOTE_LINE.test(lines[j]!)) j++
      const { attribution, remaining } = extractAttribution(buffer)
      flushRun(remaining, blocks)
      buffer = []
      blocks.push(makeQuote(lines.slice(i, j), nesting, attribution))
      i = j
      continue
    }
    buffer.push(line)
    i++
  }
  flushRun(buffer, blocks)
  return blocks
}

export function parseMessage(body: string): Block[] {
  if (body === '') return []
  const lines = body
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
    .map((l) => l.replace(/\s+$/, ''))
  const { bodyLines, signature } = splitSignature(lines)
  const blocks = parseBlocks(bodyLines, 0)
  if (signature) blocks.push(signature)
  return blocks
}
