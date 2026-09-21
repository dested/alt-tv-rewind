import { describe, expect, test } from 'bun:test'
import type { AliasesFile, EpisodeRecord, EpisodesFile } from './types'
import { buildEpisodeIndex } from './episode-index'
import { scoreThread, type ThreadText } from './scoring'
import { slugify } from './text'

function ep(season: number, number: number, title: string, airDate: string): EpisodeRecord {
  const key = `S${String(season).padStart(2, '0')}E${String(number).padStart(2, '0')}`
  return {
    key,
    slug: `${key.toLowerCase()}-${slugify(title)}`,
    season,
    number,
    title,
    airDate,
    airStamp: null,
    runtime: null,
    summary: null,
    imageUrl: null,
    tvmazeId: season * 100 + number,
    rating: null,
  }
}

function file(episodes: EpisodeRecord[]): EpisodesFile {
  return {
    fetchedAt: '2020-01-01T00:00:00Z',
    show: { tvmazeId: 1, name: 'Test', premiered: null, ended: null, network: null, summary: null, imageUrl: null },
    episodes,
  }
}

const empty: ThreadText = { subject: '', rootBody: '', replySubjects: [], replyBodies: [] }

const episodes = [
  ep(1, 1, 'The Contest', '2000-01-01'), // single-word normTitle "contest"
  ep(1, 2, 'The Soup Nazi', '2000-01-08'), // multi-word "soup nazi"
  ep(1, 3, 'The Marine Biologist', '2000-01-15'),
]
const aliases: AliasesFile = {
  'The Soup Nazi': ['no soup for you'],
  'The Contest': ['master of my domain'],
}
const index = buildEpisodeIndex(file(episodes), aliases)

describe('scoreThread window decay', () => {
  test('day 0 scores 3.5 and flags live window', () => {
    const r = scoreThread('2000-01-01T00:00:00Z', empty, index, 10)
    const top = r.candidates[0]
    expect(top?.key).toBe('S01E01')
    expect(top?.score).toBeCloseTo(3.5, 5)
    expect(top?.signals).toContain('window:+0.0d')
    expect(r.inLiveWindow).toBe(true)
  })

  test('mid-window (day 5) decays to 2.0', () => {
    const r = scoreThread('2000-01-06T00:00:00Z', empty, index, 10)
    expect(r.candidates[0]?.score).toBeCloseTo(2.0, 5)
  })

  test('edge of window (day 10) scores 0.5', () => {
    const r = scoreThread('2000-01-11T00:00:00Z', empty, index, 10)
    const contest = r.candidates.find((c) => c.key === 'S01E01')
    expect(contest?.score).toBeCloseTo(0.5, 5)
  })

  test('outside the window there is no live flag', () => {
    const r = scoreThread('2010-01-01T00:00:00Z', empty, index, 10)
    expect(r.inLiveWindow).toBe(false)
  })
})

describe('scoreThread term matching', () => {
  test('multi-word title in the subject scores +4', () => {
    const text: ThreadText = { ...empty, subject: 'the soup nazi episode was the best' }
    const r = scoreThread('2010-01-01T00:00:00Z', text, index, 10)
    const top = r.candidates[0]
    expect(top?.key).toBe('S01E02')
    expect(top?.score).toBeCloseTo(4, 5)
    expect(top?.signals).toContain('title:subject')
    expect(r.inLiveWindow).toBe(false)
  })

  test('single-word title in body is ignored without a window or subject hit', () => {
    const text: ThreadText = { ...empty, rootBody: 'i loved the contest so much' }
    const r = scoreThread('2010-01-01T00:00:00Z', text, index, 10)
    expect(r.candidates.find((c) => c.key === 'S01E01')).toBeUndefined()
  })

  test('single-word title in body is accepted inside the window', () => {
    const text: ThreadText = { ...empty, rootBody: 'the contest was great' }
    const r = scoreThread('2000-01-01T00:00:00Z', text, index, 10)
    const contest = r.candidates.find((c) => c.key === 'S01E01')
    expect(contest?.score).toBeCloseTo(3.5 + 1.5, 5)
    expect(contest?.signals).toContain('title:contest')
  })

  test('alias in the body scores +2.5', () => {
    const text: ThreadText = { ...empty, rootBody: 'no soup for you!!' }
    const r = scoreThread('2010-01-01T00:00:00Z', text, index, 10)
    const top = r.candidates[0]
    expect(top?.key).toBe('S01E02')
    expect(top?.score).toBeCloseTo(2.5, 5)
    expect(top?.signals).toContain('alias:no soup for you')
  })
})

describe('scoreThread cap', () => {
  test('never returns more than 6 candidates', () => {
    // 8 episodes airing on consecutive days, thread started on the last day so
    // all fall within a 10-day live window.
    const many = Array.from({ length: 8 }, (_, i) => ep(2, i + 1, `Episode ${i + 1}`, `2001-01-0${i + 1}`))
    const idx = buildEpisodeIndex(file(many), {})
    const r = scoreThread('2001-01-08T00:00:00Z', empty, idx, 10)
    expect(r.candidates.length).toBe(6)
    expect(r.inLiveWindow).toBe(true)
  })
})
