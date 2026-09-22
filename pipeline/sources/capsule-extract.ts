// Extract attributed pieces from a Simpsons Archive capsule. The corpus has
// three hand-written layouts (see plans/2026-09-21-capsule-provenance.md):
//   cherry   — James Cherry: plain column-0 headings, "Name: review" paragraphs
//   robinson — Benjamin Robinson: "> Heading" / ">> Subheading" + "====" rules
//   chen     — Raymond Chen early capsules: no headings (we extract nothing)
// A contribution is one blank-line-separated paragraph within a section; its
// kind comes from the section name, its span is offsets into the exact body.
// Text is retained locally only (metadata_only); it is never served as-is.

export type ContributionKind = 'review' | 'observation' | 'editorial' | 'grade' | 'quote' | 'summary' | 'unknown'
export type CapsuleLayout = 'cherry' | 'robinson' | 'chen' | 'unrecognized'

export type ContributionDraft = {
  ordinal: number
  section: string
  kind: ContributionKind
  attribution: string | null
  text: string
  spanStart: number
  spanEnd: number
}

// Cherry section headings, spelled as printed (both casings seen in the corpus).
const KNOWN_HEADINGS = new Set([
  'Reviews',
  'Comments and other observations',
  'Comments and Other Observations',
  'Quotes and Scene Summary',
  'Quotes and scene summary',
  'Freeze frame fun',
  'Freeze Frame Fun',
  'Did you notice...',
  'Contributors',
])

type Line = { text: string; start: number; end: number }

function toLines(body: string): Line[] {
  const raw = body.split('\n')
  const lines: Line[] = []
  let pos = 0
  for (const text of raw) {
    lines.push({ text, start: pos, end: pos + text.length })
    pos += text.length + 1 // + the '\n'
  }
  return lines
}

const isBlank = (line: Line | undefined): boolean => line === undefined || line.text.trim() === ''

// A generic cherry heading: a short, un-punctuated, marker-free Title-Case-ish
// label at column 0 — distinguished from a content sentence by having no
// terminal punctuation, no braces/brackets/quotes, and at most seven words.
function isGenericHeading(t: string): boolean {
  const s = t.trim()
  if (s.length < 1 || s.length > 60) return false
  if (!/^[A-Z]/.test(s)) return false
  if (/[.,!?:;-]$/.test(s)) return false
  if (/[{}[\]"]/.test(s)) return false
  if (s.includes(':')) return false // a "Label: value" line is content, not a heading
  if (s.split(/\s+/).length > 7) return false
  return true
}

// Blank-surrounded column-0 line. `known` limits it to the fixed heading set
// (layout detection); otherwise a generic Title-Case label also counts (section
// splitting inside an already-recognized cherry document).
function isCherryHeading(lines: Line[], i: number, known: boolean): boolean {
  const line = lines[i]
  if (line === undefined) return false
  const t = line.text
  if (t.length === 0 || /^\s/.test(t)) return false // must sit at column 0
  if (!isBlank(lines[i - 1]) || !isBlank(lines[i + 1])) return false
  if (KNOWN_HEADINGS.has(t.trim())) return true
  return known ? false : isGenericHeading(t)
}

// A robinson subheading: ">> Heading" or the no-space variant ">Heading" that
// the later plain-text capsules (4F24, 5F12) use. Excludes "> Heading" (major)
// and Usenet quote lines never reach 3 of these in the headingless corpus.
const NOSPACE_HEADING = /^>[^>\s]/
function isRobinsonSub(text: string): boolean {
  return text.startsWith('>> ') || NOSPACE_HEADING.test(text)
}

export function detectLayout(lines: Line[]): CapsuleLayout {
  const robinsonMarks = lines.filter((l) => isRobinsonSub(l.text)).length
  if (robinsonMarks >= 3) return 'robinson'
  // Cherry is recognized only by a known heading; generic labels alone (which a
  // headingless Chen capsule can also have) never promote a document to cherry.
  const hasKnownHeading = lines.some((_, i) => isCherryHeading(lines, i, true))
  if (hasKnownHeading) return 'cherry'
  const body = lines.map((l) => l.text).join('\n')
  if (body.includes('Episode summaries Copyright') || body.includes('HTML conversion by')) return 'chen'
  return 'unrecognized'
}

// section → base kind. quote/summary sections resolve per paragraph (script form
// vs prose); a grade paragraph overrides its section wherever it appears.
type BaseKind = 'review' | 'observation' | 'summaryquote' | 'grade' | 'editorial'
function classifySection(name: string): BaseKind {
  if (/review/i.test(name)) return 'review'
  if (/comment|observation|notice/i.test(name)) return 'observation'
  if (/quote|scene summary|summary/i.test(name)) return 'summaryquote'
  if (/grade|rating/i.test(name)) return 'grade'
  return 'editorial'
}

// A dialogue line: "Homer: …", "Number One: …" — a leading short Name then ": ".
const SCRIPT_LINE = /^\s*[A-Z][A-Za-z .']{1,30}:\s/
function isScriptForm(paragraph: string): boolean {
  let run = 0
  for (const line of paragraph.split('\n')) {
    if (SCRIPT_LINE.test(line)) {
      run++
      if (run >= 3) return true
    } else if (line.trim() !== '') {
      run = 0
    }
  }
  return false
}

const LEADING_NAME = /^\s{0,8}([A-Z][A-Za-z.'\- ]{1,40}):\s/
function extractAttribution(rawParagraph: string, sectionIsQuoteOrSummary: boolean): string | null {
  if (!sectionIsQuoteOrSummary) {
    const m = rawParagraph.match(LEADING_NAME)
    if (m && m[1] !== undefined) return m[1].trim()
  }
  const trimmedEnd = rawParagraph.trimEnd()
  const brace = trimmedEnd.match(/\{([A-Za-z][A-Za-z .'-]{0,20})\}$/)
  if (brace && brace[1] !== undefined) return brace[1].trim()
  const bracket = trimmedEnd.match(/\[([A-Z][A-Za-z .'-]{0,30})\]$/)
  if (bracket && bracket[1] !== undefined) return bracket[1].trim()
  const lastLine = rawParagraph.split('\n').at(-1)?.trim() ?? ''
  const dash = lastLine.match(/^--\s*(.+)$/)
  if (dash && dash[1] !== undefined) return dash[1].trim()
  return null
}

// One section of a capsule: content lines and the two names — `kindName` drives
// the contribution kind, `label` is the heading as printed.
type Section = { kindName: string; label: string; content: Line[] }

function cherrySections(lines: Line[]): Section[] {
  const headings: number[] = []
  lines.forEach((_, i) => {
    if (isCherryHeading(lines, i, false)) headings.push(i)
  })
  const sections: Section[] = []
  for (let h = 0; h < headings.length; h++) {
    const start = headings[h]
    if (start === undefined) continue
    const name = (lines[start]?.text ?? '').trim()
    const next = headings[h + 1] ?? lines.length
    sections.push({ kindName: name, label: name, content: lines.slice(start + 1, next) })
  }
  return sections
}

function robinsonSections(lines: Line[]): Section[] {
  const sections: Section[] = []
  let major = ''
  let sub: string | null = null
  let buf: Line[] = []
  const flush = (): void => {
    if (buf.length === 0) return
    // Kind comes from the enclosing major section when there is one; capsules
    // that use only no-space ">Heading" labels have no major, so the subheading
    // drives the kind instead.
    const kindName = major !== '' ? major : (sub ?? '')
    const label = sub ?? major
    if (kindName === '' && label === '') {
      buf = []
      return
    }
    sections.push({ kindName, label, content: buf })
    buf = []
  }
  for (const line of lines) {
    const t = line.text
    if (/^=+\s*$/.test(t)) {
      flush()
      continue // rule lines are never content
    }
    if (t.startsWith('>> ') || NOSPACE_HEADING.test(t)) {
      flush()
      sub = (t.startsWith('>> ') ? t.slice(3) : t.slice(1)).trim()
      continue
    }
    if (t.startsWith('> ')) {
      flush()
      major = t.slice(2).trim()
      sub = null
      continue
    }
    buf.push(line)
  }
  flush()
  return sections
}

function paragraphsOf(content: Line[]): Line[][] {
  const paras: Line[][] = []
  let cur: Line[] = []
  for (const line of content) {
    if (line.text.trim() === '') {
      if (cur.length > 0) {
        paras.push(cur)
        cur = []
      }
    } else {
      cur.push(line)
    }
  }
  if (cur.length > 0) paras.push(cur)
  return paras
}

export function extractContributions(body: string): { layout: CapsuleLayout; contributions: ContributionDraft[] } {
  const lines = toLines(body)
  const layout = detectLayout(lines)
  if (layout === 'chen' || layout === 'unrecognized') return { layout, contributions: [] }

  const sections = layout === 'cherry' ? cherrySections(lines) : robinsonSections(lines)
  const contributions: ContributionDraft[] = []
  let ordinal = 0

  for (const section of sections) {
    const base = classifySection(section.kindName)
    const isQuoteOrSummary = base === 'summaryquote'
    for (const para of paragraphsOf(section.content)) {
      const first = para[0]
      const last = para[para.length - 1]
      if (first === undefined || last === undefined) continue
      const spanStart = first.start
      const spanEnd = last.end
      const raw = body.slice(spanStart, spanEnd)
      const text = raw.trim()
      if (text === '') continue

      let kind: ContributionKind
      if (/^\s*(average grade|overall)\b/i.test(raw)) kind = 'grade'
      else if (base === 'summaryquote') kind = isScriptForm(raw) ? 'quote' : 'summary'
      else kind = base

      const attribution = extractAttribution(raw, isQuoteOrSummary)

      // A stray short line in a review section with no attribution is noise.
      if (base === 'review' && attribution === null && text.length < 40) continue

      ordinal += 1
      contributions.push({ ordinal, section: section.label, kind, attribution, text, spanStart, spanEnd })
    }
  }

  return { layout, contributions }
}
