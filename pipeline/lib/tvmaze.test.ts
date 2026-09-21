import { describe, expect, test } from 'bun:test'
import { normalizeEpisodes, type TvmazeShow } from './tvmaze'

const raw: TvmazeShow = {
  id: 42,
  name: 'Fixture Show',
  premiered: '1990-01-01',
  ended: '1990-12-31',
  network: { name: 'NBC' },
  webChannel: null,
  summary: '<p>A show &amp; more</p>',
  image: { original: 'http://img/show.jpg' },
  rating: { average: 8.1 },
  _embedded: {
    episodes: [
      // special — no episode number, must be skipped
      { id: 1, name: 'Special Preview', season: 0, number: null, type: 'special', airdate: '1990-01-01', airtime: '', airstamp: null, runtime: null, summary: null, image: null, rating: null },
      // two-parter with HTML summary + image
      { id: 2, name: 'The Finale (1)', season: 1, number: 1, type: 'regular', airdate: '1990-02-01', airtime: '20:00', airstamp: '1990-02-01T01:00:00+00:00', runtime: 30, summary: '<p>Part &amp; one</p>', image: { original: 'http://img/1.jpg' }, rating: { average: 8 } },
      // missing image + null rating
      { id: 3, name: 'The Finale (2)', season: 1, number: 2, type: 'regular', airdate: '1990-02-01', airtime: '20:30', airstamp: '1990-02-01T01:30:00+00:00', runtime: 30, summary: null, image: null, rating: { average: null } },
      // no air date, must be skipped
      { id: 4, name: 'Unaired', season: 1, number: 3, type: 'regular', airdate: '', airtime: '', airstamp: null, runtime: null, summary: null, image: null, rating: null },
    ],
  },
}

describe('normalizeEpisodes', () => {
  const out = normalizeEpisodes(raw)

  test('drops specials and un-aired episodes', () => {
    expect(out.episodes.length).toBe(2)
    expect(out.episodes.map((e) => e.key)).toEqual(['S01E01', 'S01E02'])
  })

  test('keys, slugs, and two-parter naming', () => {
    expect(out.episodes.map((e) => e.slug)).toEqual(['s01e01-the-finale-1', 's01e02-the-finale-2'])
  })

  test('strips HTML in summaries', () => {
    expect(out.episodes[0]?.summary).toBe('Part & one')
    expect(out.episodes[1]?.summary).toBeNull()
  })

  test('maps image, rating, airstamp, runtime with nullables', () => {
    expect(out.episodes[0]?.imageUrl).toBe('http://img/1.jpg')
    expect(out.episodes[0]?.rating).toBe(8)
    expect(out.episodes[0]?.airStamp).toBe('1990-02-01T01:00:00+00:00')
    expect(out.episodes[0]?.runtime).toBe(30)
    expect(out.episodes[1]?.imageUrl).toBeNull()
    expect(out.episodes[1]?.rating).toBeNull()
  })

  test('show meta', () => {
    expect(out.show.tvmazeId).toBe(42)
    expect(out.show.network).toBe('NBC')
    expect(out.show.summary).toBe('A show & more')
    expect(out.show.imageUrl).toBe('http://img/show.jpg')
    expect(out.show.premiered).toBe('1990-01-01')
    expect(out.show.ended).toBe('1990-12-31')
  })

  test('falls back to webChannel when there is no network', () => {
    const web: TvmazeShow = { ...raw, network: null, webChannel: { name: 'HBO' } }
    expect(normalizeEpisodes(web).show.network).toBe('HBO')
  })
})
