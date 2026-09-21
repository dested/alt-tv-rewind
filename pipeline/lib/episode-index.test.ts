import { describe, expect, test } from 'bun:test'
import type { EpisodeRecord, EpisodesFile } from './types'
import { buildEpisodeIndex } from './episode-index'
import { normalizeTitle, slugify } from './text'

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

describe('buildEpisodeIndex', () => {
  const twoParter = file([ep(3, 17, 'The Boyfriend (1)', '1992-02-12'), ep(3, 18, 'The Boyfriend (2)', '1992-02-12')])

  test('both parts of a two-parter share a normalized title', () => {
    expect(normalizeTitle('The Boyfriend (1)')).toBe('boyfriend')
    expect(normalizeTitle('The Boyfriend (2)')).toBe('boyfriend')
    const index = buildEpisodeIndex(twoParter, {})
    expect(index.resolveTitle('The Boyfriend').map((e) => e.key)).toEqual(['S03E17', 'S03E18'])
    expect(index.byNormTitle.get('boyfriend')?.length).toBe(2)
  })

  test('a title term for a two-parter points at both keys', () => {
    const index = buildEpisodeIndex(twoParter, {})
    const term = index.terms.find((t) => t.phrase === 'boyfriend' && t.source === 'title')
    expect(term?.keys).toEqual(['S03E17', 'S03E18'])
  })

  test('an alias title matching no episode throws', () => {
    expect(() => buildEpisodeIndex(twoParter, { 'The Nonexistent Episode': ['foo'] })).toThrow(/match no episode/)
  })
})
