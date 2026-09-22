import { describe, expect, test } from 'bun:test'
import { buildEpisodeIndex } from '../lib/episode-index'
import type { EpisodeRecord, EpisodesFile } from '../lib/types'
import { parseCapsuleAirDate, resolveCapsuleEpisode } from './capsule-episode'

function ep(key: string, title: string, airDate: string, season: number, number: number): EpisodeRecord {
  return {
    key,
    slug: `${key.toLowerCase()}-${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
    season,
    number,
    title,
    airDate,
    airStamp: null,
    runtime: 22,
    summary: null,
    imageUrl: null,
    tvmazeId: 1000 + number,
    rating: null,
  }
}

function index(episodes: EpisodeRecord[]) {
  const file: EpisodesFile = {
    fetchedAt: '2026-09-21T00:00:00.000Z',
    show: {
      tvmazeId: 83,
      name: 'The Simpsons',
      premiered: '1989-12-17',
      ended: null,
      network: 'FOX',
      summary: null,
      imageUrl: null,
    },
    episodes,
  }
  return buildEpisodeIndex(file, {})
}

const EPISODES = [
  ep('S06E12', 'Homer the Great', '1995-01-08', 6, 12),
  ep('S04E12', 'Marge vs. the Monorail', '1993-01-14', 4, 12),
  ep('S05E04', 'Rosebud', '1993-10-21', 5, 4),
  ep('DABF01', 'Brawl in the Family', '2002-01-06', 13, 7),
  // A same-night double airing for the ambiguous case.
  ep('S07E24', 'Homerpalooza', '1996-05-19', 7, 24),
  ep('S07E25', 'Summer of 4 ft. 2', '1996-05-19', 7, 25),
  // Titles that only match a capsule after "&"/"and" normalization.
  ep('S02E09', 'Itchy & Scratchy & Marge', '1990-12-20', 2, 9),
  ep('S02E04', 'Two Cars in Every Garage and Three Eyes on Every Fish', '1990-11-01', 2, 4),
]

describe('parseCapsuleAirDate', () => {
  test('reads the "Original airdate in N.A.:" line, 2-digit year 89-99 → 19xx', () => {
    expect(parseCapsuleAirDate('Production code: 2F09    Original airdate in N.A.: 8-Jan-95\n')).toBe('1995-01-08')
  })

  test('accepts a bare "Airdate:" label', () => {
    expect(parseCapsuleAirDate('Airdate: 21-Oct-93')).toBe('1993-10-21')
  })

  test('4-digit years pass through', () => {
    expect(parseCapsuleAirDate('Original airdate: 6-Jan-2002')).toBe('2002-01-06')
  })

  test('2-digit year 00-30 → 20xx', () => {
    expect(parseCapsuleAirDate('Airdate: 6-Jan-02')).toBe('2002-01-06')
  })

  test('a 2-digit year outside the run (31-88) is unusable', () => {
    expect(parseCapsuleAirDate('Airdate: 1-Jan-45')).toBeNull()
  })

  test('no airdate line → null', () => {
    expect(parseCapsuleAirDate('HTML conversion by someone, 10 Sept 1994\nno broadcast date here')).toBeNull()
  })

  test('an unknown month token → null', () => {
    expect(parseCapsuleAirDate('Airdate: 8-Zzz-95')).toBeNull()
  })
})

describe('resolveCapsuleEpisode', () => {
  const idx = index(EPISODES)

  test('unique airdate wins (capsule-airdate)', () => {
    expect(
      resolveCapsuleEpisode(
        { title: '[2F09] Homer the Great', body: 'Original airdate in N.A.: 8-Jan-95', productionCode: '2F09' },
        idx
      )
    ).toEqual({ episodeKey: 'S06E12', method: 'capsule-airdate', reason: null })
  })

  test('no airdate line → title fallback (capsule-title)', () => {
    expect(
      resolveCapsuleEpisode(
        { title: 'Marge vs. the Monorail', body: 'HTML conversion by ...\ncomments follow', productionCode: null },
        idx
      )
    ).toEqual({ episodeKey: 'S04E12', method: 'capsule-title', reason: null })
  })

  test('production-code prefix is stripped before title resolution', () => {
    expect(
      resolveCapsuleEpisode({ title: '[1F01] Rosebud', body: 'no date line', productionCode: '1F01' }, idx)
    ).toEqual({ episodeKey: 'S05E04', method: 'capsule-title', reason: null })
  })

  test('double airing with a matching title picks the match', () => {
    expect(
      resolveCapsuleEpisode(
        { title: 'Homerpalooza', body: 'Original airdate: 19-May-96', productionCode: null },
        idx
      )
    ).toEqual({ episodeKey: 'S07E24', method: 'capsule-airdate', reason: null })
  })

  test('double airing with no title match is ambiguous', () => {
    expect(
      resolveCapsuleEpisode(
        { title: 'Some Compilation', body: 'Original airdate: 19-May-96', productionCode: null },
        idx
      )
    ).toEqual({ episodeKey: null, method: null, reason: 'ambiguous_airdate' })
  })

  test('title fallback collapses "&" vs "and"', () => {
    expect(
      resolveCapsuleEpisode({ title: 'Itchy and Scratchy and Marge', body: 'no date line', productionCode: null }, idx)
    ).toEqual({ episodeKey: 'S02E09', method: 'capsule-title', reason: null, fallback: true })
  })

  test('title fallback collapses a dropped "and"', () => {
    expect(
      resolveCapsuleEpisode(
        { title: 'Two Cars in Every Garage, Three Eyes on Every Fish', body: 'no date line', productionCode: null },
        idx
      )
    ).toEqual({ episodeKey: 'S02E04', method: 'capsule-title', reason: null, fallback: true })
  })

  test('unknown title and no airdate → unresolved', () => {
    expect(
      resolveCapsuleEpisode({ title: 'Nonexistent Episode', body: 'nothing here', productionCode: null }, idx)
    ).toEqual({ episodeKey: null, method: null, reason: 'unresolved_episode' })
  })
})
