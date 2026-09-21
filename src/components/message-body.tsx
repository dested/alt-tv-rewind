import { Fragment, type ReactNode } from 'react'

// Renders a Usenet message body in the wire voice: quote levels as nested rails
// (markers left visible — that's how Usenet reads), signature dimmed. Text goes
// in as React children (auto-escaped); nothing is reflowed or linkified.

const MAX_QUOTE_DEPTH = 3

function quoteDepth(line: string): number {
  const m = line.match(/^(\s?>)+/)
  if (!m) return 0
  return (m[0].match(/>/g) ?? []).length
}

// Collapse runs of more than two blank lines down to two.
function collapseBlanks(lines: string[]): string[] {
  const out: string[] = []
  let blanks = 0
  for (const line of lines) {
    if (line.trim() === '') {
      blanks++
      if (blanks <= 2) out.push(line)
    } else {
      blanks = 0
      out.push(line)
    }
  }
  return out
}

type Group = { depth: number; text: string }

// Group consecutive lines of equal quote depth into one text block.
function toGroups(lines: string[]): Group[] {
  const groups: Group[] = []
  for (const line of lines) {
    const depth = quoteDepth(line)
    const last = groups[groups.length - 1]
    if (last && last.depth === depth) {
      last.text += `\n${line}`
    } else {
      groups.push({ depth, text: line })
    }
  }
  return groups
}

function renderGroups(lines: string[]): ReactNode {
  return toGroups(collapseBlanks(lines)).map((group, i) => {
    const capped = Math.min(group.depth, MAX_QUOTE_DEPTH)
    let node: ReactNode = group.text
    for (let d = 0; d < capped; d++) {
      node = <div className="usenet-quote">{node}</div>
    }
    if (capped === 0) node = <div>{node}</div>
    return <Fragment key={i}>{node}</Fragment>
  })
}

export function MessageBody({ body }: { body: string }) {
  const lines = body.split('\n')

  // Signature: from the first line whose right-trim equals '--' to the end.
  let sigStart = -1
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (line !== undefined && line.replace(/[ \t]+$/, '') === '--') {
      sigStart = i
      break
    }
  }
  const bodyLines = sigStart === -1 ? lines : lines.slice(0, sigStart)
  const sigLines = sigStart === -1 ? [] : lines.slice(sigStart)

  return (
    <div className="usenet">
      {renderGroups(bodyLines)}
      {sigLines.length > 0 && <div className="usenet-sig">{sigLines.join('\n')}</div>}
    </div>
  )
}
