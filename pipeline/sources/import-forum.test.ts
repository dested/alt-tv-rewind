import { describe, expect, test } from 'bun:test'
import {
  guestPosterKey,
  majorityEpisodeId,
  partitionByExisting,
  postTimingCounts,
  resolvePoster,
  topicRelation,
} from './import-forum'

const SOURCE = 'southpark-official-forum'

describe('guestPosterKey', () => {
  test('is the first 16 hex of sha256("forum:<source>:guest")', () => {
    const expected = new Bun.CryptoHasher('sha256').update(`forum:${SOURCE}:guest`).digest('hex').slice(0, 16)
    expect(guestPosterKey(SOURCE)).toBe(expected)
    expect(guestPosterKey(SOURCE)).toMatch(/^[0-9a-f]{16}$/)
  })

  test('every guest collapses to the one shared key', () => {
    expect(guestPosterKey(SOURCE)).toBe(guestPosterKey(SOURCE))
  })
})

describe('resolvePoster', () => {
  test('a real account keeps its key and display name', () => {
    expect(resolvePoster('abc123', 'Cartman', SOURCE)).toEqual({ key: 'abc123', displayName: 'Cartman', guest: false })
  })

  test('a null poster_key becomes the guest key with the printed name', () => {
    expect(resolvePoster(null, 'someName', SOURCE)).toEqual({ key: guestPosterKey(SOURCE), displayName: 'someName', guest: true })
  })

  test('a null poster_key with no name falls back to "deleted user"', () => {
    expect(resolvePoster(null, null, SOURCE)).toEqual({ key: guestPosterKey(SOURCE), displayName: 'deleted user', guest: true })
  })
})

describe('topicRelation', () => {
  test('a topic opened 2 days before air with posts through day +5 is live', () => {
    expect(topicRelation([-2, 0, 3, 5], 10)).toBe('live')
  })

  test('a topic with posts only on day +20 is retro', () => {
    expect(topicRelation([20], 10)).toBe('retro')
  })

  test('the day before the air date counts as live (window starts at -1)', () => {
    expect(topicRelation([-1], 10)).toBe('live')
  })

  test('two days before with nothing inside the window is retro', () => {
    expect(topicRelation([-2, 30], 10)).toBe('retro')
  })

  test('undated posts (null) never make a topic live', () => {
    expect(topicRelation([null, null], 10)).toBe('retro')
  })
})

describe('postTimingCounts', () => {
  test('splits posts into before / live / later against the window', () => {
    expect(postTimingCounts([-2, 0, 3, 5], 10)).toEqual({ livePosts: 3, beforePosts: 1, laterPosts: 0 })
  })

  test('a day-+20-only topic is all later', () => {
    expect(postTimingCounts([20], 10)).toEqual({ livePosts: 0, beforePosts: 0, laterPosts: 1 })
  })

  test('undated posts are counted in none of the three', () => {
    expect(postTimingCounts([null, 0, null, 40], 10)).toEqual({ livePosts: 1, beforePosts: 0, laterPosts: 1 })
  })
})

describe('partitionByExisting', () => {
  test('a post whose canonical id is already projected is alreadyImported, no insert row', () => {
    const recs = [{ canonicalId: 'forum:s:1' }, { canonicalId: 'forum:s:2' }, { canonicalId: 'forum:s:3' }]
    const { toInsert, alreadyImported } = partitionByExisting(recs, new Set(['forum:s:2']))
    expect(alreadyImported).toBe(1)
    expect(toInsert.map((r) => r.canonicalId)).toEqual(['forum:s:1', 'forum:s:3'])
  })

  test('an empty projection inserts everything', () => {
    const recs = [{ canonicalId: 'a' }, { canonicalId: 'b' }]
    const { toInsert, alreadyImported } = partitionByExisting(recs, new Set())
    expect(alreadyImported).toBe(0)
    expect(toInsert).toHaveLength(2)
  })

  test('a fully projected topic inserts nothing', () => {
    const recs = [{ canonicalId: 'a' }, { canonicalId: 'b' }]
    const { toInsert, alreadyImported } = partitionByExisting(recs, new Set(['a', 'b']))
    expect(alreadyImported).toBe(2)
    expect(toInsert).toHaveLength(0)
  })
})

describe('majorityEpisodeId', () => {
  test('a unanimous topic returns its episode with no disagreement', () => {
    expect(majorityEpisodeId([7, 7, 7])).toEqual({ episodeId: 7, disagreement: false })
  })

  test('a stray episode loses to the majority and flags disagreement', () => {
    expect(majorityEpisodeId([7, 7, 9])).toEqual({ episodeId: 7, disagreement: true })
  })

  test('nulls are ignored', () => {
    expect(majorityEpisodeId([null, 5, null])).toEqual({ episodeId: 5, disagreement: false })
  })

  test('no episode at all returns null', () => {
    expect(majorityEpisodeId([null, null])).toEqual({ episodeId: null, disagreement: false })
  })
})
