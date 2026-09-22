// Deterministic relevance screening of one Usenet record against one show.
// Pure functions only: screenRecord turns a record + show config into signals,
// dispose turns signals into a reviewed disposition. The catalog stage decides
// which dispositions to keep and layers conversation context on top; nothing
// here touches the DB or the corpus files, so the tests use inline fixtures.
import type { EpisodeIndex } from '../lib/episode-index'
import { MIN_TERM_CHARS } from '../lib/scoring'
import { withoutQuotedLines } from '../lib/text'
import type { AssociationStatus } from './types'

// The signals a record raises for a show. bodyTerm is the first show term that
// matched the unquoted body — carried so dispose() can name it in the evidence
// (added to the spec's fields; dispose only sees signals, so a body-term
// disposition has no other way to cite which term it saw).
export type ScreenSignals = {
  spam: string | null
  crosspost: string | null // first of the show's groups present in Newsgroups
  subjectShow: string | null // first show term found in the normalized subject
  bodyShowCount: number // boundary matches of any show term in the unquoted body
  quotedShowOnly: boolean // mentioned only inside quoted/attribution lines
  episodeSubject: string[] // episode keys matched in the subject
  episodeBody: string[] // episode keys matched in the unquoted body
  bodyTerm: string | null
}

export type ShowScreenConfig = {
  slug: string
  terms: string[] // lowercase show-name terms (SHOW_TERMS)
  groups: string[] // newsgroups that count as this show's own distribution
  index: EpisodeIndex
}

// A show term is mentioned in the body when it clears two thresholds together.
const BODY_CAP = 6000

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// Collapse everything but [a-z0-9] in a term to single spaces, matching how
// subjectNorm and the scorer normalize text before boundary matching.
function normTerm(term: string): string {
  return term
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

type Compiled = {
  groupsLower: string[]
  termRes: { term: string; test: RegExp; count: RegExp }[]
  episodeRes: { keys: string[]; test: RegExp }[]
}

// Regexes are precompiled once per show config (the same object is reused for
// every record in the source), not once per record.
const cache = new WeakMap<ShowScreenConfig, Compiled>()

function compile(show: ShowScreenConfig): Compiled {
  const cached = cache.get(show)
  if (cached !== undefined) return cached
  const termRes = show.terms.map((term) => {
    const body = '(?:^|[^a-z0-9])' + escapeRegExp(normTerm(term)) + '(?=$|[^a-z0-9])'
    return { term, test: new RegExp(body), count: new RegExp(body, 'g') }
  })
  const episodeRes: { keys: string[]; test: RegExp }[] = []
  for (const t of show.index.terms) {
    if (t.source === 'title' && t.singleWord) continue
    if (t.phrase.length < MIN_TERM_CHARS) continue
    episodeRes.push({ keys: t.keys, test: new RegExp('(?:^|[^a-z0-9])' + escapeRegExp(normTerm(t.phrase)) + '(?=$|[^a-z0-9])') })
  }
  const compiled: Compiled = { groupsLower: show.groups.map((g) => g.toLowerCase()), termRes, episodeRes }
  cache.set(show, compiled)
  return compiled
}

function matchEpisodes(res: Compiled['episodeRes'], text: string): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const e of res) {
    if (!e.test.test(text)) continue
    for (const key of e.keys) {
      if (seen.has(key)) continue
      seen.add(key)
      out.push(key)
    }
  }
  return out
}

export function screenRecord(
  input: { subject: string; subjectNorm: string; body: string; newsgroups: string[]; spamReason: string | null },
  show: ShowScreenConfig
): ScreenSignals {
  const c = compile(show)
  const subjectNorm = input.subjectNorm // already lowercased + normalized
  const newsLower = input.newsgroups.map((n) => n.toLowerCase())
  const unquoted = withoutQuotedLines(input.body)
  const unquotedLower = unquoted.slice(0, BODY_CAP).toLowerCase()

  const crosspost = c.groupsLower.find((g) => newsLower.includes(g)) ?? null

  let subjectShow: string | null = null
  for (const t of c.termRes) {
    if (t.test.test(subjectNorm)) {
      subjectShow = t.term
      break
    }
  }

  let bodyShowCount = 0
  let bodyTerm: string | null = null
  for (const t of c.termRes) {
    t.count.lastIndex = 0
    let n = 0
    while (t.count.exec(unquotedLower) !== null) n++
    if (n > 0 && bodyTerm === null) bodyTerm = t.term
    bodyShowCount += n
  }

  let quotedShowOnly = false
  if (bodyShowCount === 0 && subjectShow === null) {
    // A term present in the full body but absent from the unquoted body sits in
    // a quoted or attribution line.
    const fullLower = input.body.toLowerCase()
    quotedShowOnly = c.termRes.some((t) => t.test.test(fullLower))
  }

  const gate = crosspost !== null || subjectShow !== null || bodyShowCount > 0
  const episodeSubject = gate ? matchEpisodes(c.episodeRes, subjectNorm) : []
  const episodeBody = gate ? matchEpisodes(c.episodeRes, unquotedLower) : []

  return { spam: input.spamReason, crosspost, subjectShow, bodyShowCount, quotedShowOnly, episodeSubject, episodeBody, bodyTerm }
}

export type ScreenDisposition = {
  status: AssociationStatus
  method: string
  evidence: string
  confidence: number | null
  reason: string | null
}

// Rules in fixed order; the first that fires wins. Accepts carry a confidence
// and no reason; excludes/needs_review carry a reason and no confidence.
export function dispose(signals: ScreenSignals): ScreenDisposition {
  if (signals.spam !== null) {
    return { status: 'excluded', method: 'screen', evidence: signals.spam, confidence: null, reason: 'spam' }
  }
  if (signals.crosspost !== null) {
    return { status: 'accepted', method: 'crosspost', evidence: `newsgroups:${signals.crosspost}`, confidence: 95, reason: null }
  }
  if (signals.subjectShow !== null) {
    return { status: 'accepted', method: 'subject-term', evidence: `subject:'${signals.subjectShow}'`, confidence: 90, reason: null }
  }
  if (signals.episodeSubject.length > 0) {
    return {
      status: 'accepted',
      method: 'subject-episode',
      evidence: `subject-episode:${signals.episodeSubject.join(',')}`,
      confidence: 85,
      reason: null,
    }
  }
  if (signals.bodyShowCount >= 2 || (signals.bodyShowCount >= 1 && signals.episodeBody.length > 0)) {
    let evidence = `body:${signals.bodyShowCount}×'${signals.bodyTerm ?? ''}'`
    if (signals.episodeBody.length > 0) evidence += `; episode:${signals.episodeBody.join(',')}`
    return { status: 'accepted', method: 'body-term', evidence, confidence: 70, reason: null }
  }
  if (signals.bodyShowCount === 1) {
    return { status: 'needs_review', method: 'screen', evidence: `body:1×'${signals.bodyTerm ?? ''}'`, confidence: null, reason: 'incidental_mention' }
  }
  if (signals.quotedShowOnly) {
    return { status: 'excluded', method: 'screen', evidence: 'quoted', confidence: null, reason: 'quoted_mention' }
  }
  return { status: 'excluded', method: 'screen', evidence: '', confidence: null, reason: 'no_mention' }
}
