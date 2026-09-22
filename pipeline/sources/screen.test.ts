import { expect, test } from 'bun:test'
import type { EpisodeIndex } from '../lib/episode-index'
import { dispose, screenRecord, type ShowScreenConfig } from './screen'

const index: EpisodeIndex = {
  byKey: new Map(),
  byNormTitle: new Map(),
  terms: [
    { phrase: 'stewie kills lois', keys: ['S04E28'], source: 'title', singleWord: false },
    { phrase: 'pts', keys: ['S02E01'], source: 'title', singleWord: true }, // single-word title → skipped
  ],
  resolveTitle: () => [],
}

const show: ShowScreenConfig = {
  slug: 'family-guy',
  terms: ['family guy'],
  groups: ['alt.tv.family-guy', 'alt.tv.familyguy'],
  index,
}

function screen(input: Partial<{ subject: string; subjectNorm: string; body: string; newsgroups: string[]; spamReason: string | null }>) {
  return screenRecord(
    {
      subject: input.subject ?? '',
      subjectNorm: input.subjectNorm ?? '',
      body: input.body ?? '',
      newsgroups: input.newsgroups ?? [],
      spamReason: input.spamReason ?? null,
    },
    show
  )
}

test('spam excludes before anything else', () => {
  const d = dispose(screen({ subjectNorm: 'family guy rules', spamReason: 'urls' }))
  expect(d.status).toBe('excluded')
  expect(d.reason).toBe('spam')
})

test('crosspost into the show group is accepted', () => {
  const s = screen({ subjectNorm: 'random chat', newsgroups: ['alt.tv.er', 'alt.tv.familyguy'] })
  expect(s.crosspost).toBe('alt.tv.familyguy')
  const d = dispose(s)
  expect(d.status).toBe('accepted')
  expect(d.method).toBe('crosspost')
  expect(d.confidence).toBe(95)
  expect(d.evidence).toBe('newsgroups:alt.tv.familyguy')
})

test('a show term in the subject is accepted', () => {
  const s = screen({ subjectNorm: 'family guy is back tonight' })
  expect(s.subjectShow).toBe('family guy')
  const d = dispose(s)
  expect(d.status).toBe('accepted')
  expect(d.method).toBe('subject-term')
  expect(d.confidence).toBe(90)
})

test('an episode phrase in the subject (gated by a body mention) is accepted', () => {
  const s = screen({ subjectNorm: 'stewie kills lois tonight', body: 'watched family guy last night' })
  expect(s.subjectShow).toBeNull()
  expect(s.episodeSubject).toEqual(['S04E28'])
  const d = dispose(s)
  expect(d.status).toBe('accepted')
  expect(d.method).toBe('subject-episode')
  expect(d.evidence).toBe('subject-episode:S04E28')
})

test('two body mentions are accepted as a body term', () => {
  const s = screen({ body: 'i love family guy and family guy is great' })
  expect(s.bodyShowCount).toBe(2)
  expect(s.bodyTerm).toBe('family guy')
  const d = dispose(s)
  expect(d.status).toBe('accepted')
  expect(d.method).toBe('body-term')
  expect(d.evidence).toContain("body:2×'family guy'")
})

test('a single body mention needs review', () => {
  const s = screen({ body: 'saw a bit of family guy once' })
  expect(s.bodyShowCount).toBe(1)
  const d = dispose(s)
  expect(d.status).toBe('needs_review')
  expect(d.reason).toBe('incidental_mention')
})

test('a mention only inside a quoted line is excluded', () => {
  const s = screen({ body: '> family guy is the best show\nI disagree completely' })
  expect(s.bodyShowCount).toBe(0)
  expect(s.quotedShowOnly).toBe(true)
  const d = dispose(s)
  expect(d.status).toBe('excluded')
  expect(d.reason).toBe('quoted_mention')
})

test('no mention at all is excluded', () => {
  const d = dispose(screen({ subjectNorm: 'the weather today', body: 'nothing relevant here' }))
  expect(d.status).toBe('excluded')
  expect(d.reason).toBe('no_mention')
})

test('episode terms are not evaluated without a show signal', () => {
  const s = screen({ subjectNorm: 'stewie kills lois tonight', body: 'unrelated body' })
  expect(s.episodeSubject).toEqual([]) // gate is closed: no crosspost/subjectShow/body mention
  const d = dispose(s)
  expect(d.status).toBe('excluded')
  expect(d.reason).toBe('no_mention')
})
