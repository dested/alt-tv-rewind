// phpBB → Usenet quote grammar. The forum catalog stores post bodies verbatim
// with their `[quote]` markers; the import converts them here so the existing
// message parser (which folds `>`-prefixed lines and "Name wrote:" attributions)
// treats a quoted reply the same as a Usenet one.
//
//   [quote="Name"]…[/quote]  → a line `Name wrote:` then each inner line `> `
//   [quote]…[/quote]         → inner lines `> ` (no attribution)
//   nested quotes add one `> ` per level
//   marker lines are removed; runs of blank lines collapse to one
//   unbalanced markers are dropped, their surrounding text left as-is
// Everything outside a quote (smilies like :lol:, links, text) stays verbatim.

type Event = { kind: 'open'; name: string | null } | { kind: 'close' } | { kind: 'text'; text: string }

// `[quote]`, `[quote=Name]`, `[quote="Name"]`, and `[/quote]`, case-insensitive.
const TAG = /\[quote(?:\s*=\s*"?([^\]"]*)"?)?\]|\[\/quote\]/gi

function tokenize(body: string): Event[] {
  const events: Event[] = []
  let last = 0
  TAG.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = TAG.exec(body)) !== null) {
    if (m.index > last) events.push({ kind: 'text', text: body.slice(last, m.index) })
    if (m[0].toLowerCase().startsWith('[/')) events.push({ kind: 'close' })
    else events.push({ kind: 'open', name: (m[1] ?? '').trim() || null })
    last = m.index + m[0].length
  }
  if (last < body.length) events.push({ kind: 'text', text: body.slice(last) })
  return events
}

function quotePrefix(depth: number): string {
  return '> '.repeat(depth)
}

export function forumBodyToUsenet(body: string): string {
  const events = tokenize(body)
  const out: string[] = []
  let depth = 0

  const emitText = (text: string, prevIsTag: boolean, nextIsTag: boolean): void => {
    const lines = text.split('\n')
    // A marker on its own line leaves an empty line on each side once removed;
    // drop the one adjacent to the marker so the block stays tight.
    if (prevIsTag && lines.length > 0 && lines[0] === '') lines.shift()
    if (nextIsTag && lines.length > 0 && lines[lines.length - 1] === '') lines.pop()
    const prefix = quotePrefix(depth)
    for (const line of lines) {
      if (line === '') out.push(depth > 0 ? prefix.trimEnd() : '')
      else out.push(prefix + line)
    }
  }

  events.forEach((ev, i) => {
    if (ev.kind === 'open') {
      if (ev.name !== null) out.push(quotePrefix(depth) + `${ev.name} wrote:`)
      depth++
    } else if (ev.kind === 'close') {
      // An unbalanced close (no open) is a stray marker: drop it, keep the text.
      if (depth > 0) depth--
    } else {
      const prev = events[i - 1]
      const next = events[i + 1]
      const prevIsTag = prev !== undefined && prev.kind !== 'text'
      const nextIsTag = next !== undefined && next.kind !== 'text'
      emitText(ev.text, prevIsTag, nextIsTag)
    }
  })

  // Collapse runs of blank lines to one and trim leading/trailing blanks.
  const normalized: string[] = []
  for (const line of out) {
    if (line === '' && normalized[normalized.length - 1] === '') continue
    normalized.push(line)
  }
  while (normalized.length > 0 && normalized[0] === '') normalized.shift()
  while (normalized.length > 0 && normalized[normalized.length - 1] === '') normalized.pop()
  return normalized.join('\n')
}
