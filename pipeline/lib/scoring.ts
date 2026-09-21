// Heuristic episode attribution. Given a thread's start time and a little of its
// text, score each episode by two signals: how close the thread started to an
// air date ("window"), and whether the episode's title/aliases appear in the
// subject or body ("term"). Deterministic and cheap — the LLM classify stage
// refines the winners later.
import { airDateMs, type EpisodeIndex } from './episode-index'
import type { CandidateRecord } from './types'

type Candidate = CandidateRecord['candidates'][number]

// Phrases shorter than this are never matched as bare titles/aliases — too noisy.
// (No further title stoplist is needed; the single-word title rule below covers
// the rest.)
export const MIN_TERM_CHARS = 4

// All fields already lowercased by the caller; bodies already quote-stripped and
// truncated (root 3000 chars, up to 2 replies at 1500 each).
export type ThreadText = {
  subject: string
  rootBody: string
  replySubjects: string[]
  replyBodies: string[]
}

const DAY_MS = 86_400_000

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// Word-boundary match that treats anything but [a-z0-9] as a separator.
function boundaryRegex(phrase: string): RegExp {
  return new RegExp('(^|[^a-z0-9])' + escapeRegExp(phrase) + '($|[^a-z0-9])')
}

export function scoreThread(
  startedAtIso: string,
  text: ThreadText,
  index: EpisodeIndex,
  liveWindowDays: number,
): { candidates: Candidate[]; inLiveWindow: boolean } {
  const acc = new Map<string, { score: number; signals: Set<string> }>()
  const bump = (key: string, score: number, signal: string): void => {
    let a = acc.get(key)
    if (!a) {
      a = { score: 0, signals: new Set() }
      acc.set(key, a)
    }
    a.score += score
    a.signals.add(signal)
  }

  // window signal
  const startedAt = Date.parse(startedAtIso)
  const windowKeys = new Set<string>()
  let inLiveWindow = false
  for (const ep of index.byKey.values()) {
    const daysAfter = (startedAt - airDateMs(ep)) / DAY_MS
    if (daysAfter >= -1 && daysAfter <= liveWindowDays) {
      const ratio = liveWindowDays > 0 ? Math.max(daysAfter, 0) / liveWindowDays : 0
      const score = 0.5 + 3 * Math.max(0, 1 - ratio)
      bump(ep.key, score, `window:${daysAfter >= 0 ? '+' : ''}${daysAfter.toFixed(1)}d`)
      windowKeys.add(ep.key)
      inLiveWindow = true
    }
  }

  // term matching
  for (const term of index.terms) {
    if (term.phrase.length < MIN_TERM_CHARS) continue
    const re = boundaryRegex(term.phrase)
    const inSubject = re.test(text.subject) || text.replySubjects.some((s) => re.test(s))
    if (inSubject) {
      // +4 once per term regardless of how many subjects matched
      for (const key of term.keys) bump(key, 4, `${term.source}:subject`)
    }

    const theRe =
      term.source === 'title' && term.singleWord
        ? new RegExp('(^|[^a-z0-9])the ' + escapeRegExp(term.phrase) + '($|[^a-z0-9])')
        : null

    const applyBody = (body: string, mult: number): void => {
      if (!re.test(body)) return
      if (term.source === 'alias') {
        for (const key of term.keys) bump(key, 2.5 * mult, `alias:${term.phrase}`)
      } else if (!term.singleWord) {
        for (const key of term.keys) bump(key, 2 * mult, `title:${term.phrase}`)
      } else {
        // single-word title: needs literal "the <word>" AND the episode already
        // has a reason (window candidate or the word in the subject).
        if (!theRe || !theRe.test(body)) return
        for (const key of term.keys) {
          if (windowKeys.has(key) || inSubject) bump(key, 1.5 * mult, `title:${term.phrase}`)
        }
      }
    }

    applyBody(text.rootBody, 1)
    for (const rb of text.replyBodies) applyBody(rb, 0.5)
  }

  const candidates: Candidate[] = [...acc.entries()]
    .map(([key, a]) => ({ key, score: a.score, signals: [...a.signals] }))
    .sort((x, y) => y.score - x.score)
    .slice(0, 6)

  return { candidates, inLiveWindow }
}
