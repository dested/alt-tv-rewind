import { describe, expect, test } from 'bun:test'
import { importUsenet } from './import-usenet'
import { buildEpisodeIndex } from '../lib/episode-index'
import type { EpisodesFile } from '../lib/types'
import type { ImportContext, SourceInfo } from './import'

// The projection's decision logic is unit-tested in projection.test.ts. Here we
// cover the one importUsenet path that touches neither the DB nor the filesystem:
// a show whose cataloged sources contain no Usenet source is a clean no-op with
// a well-formed, zeroed summary.

const episodesFile: EpisodesFile = {
  fetchedAt: '2020-01-01T00:00:00Z',
  show: { tvmazeId: 1, name: 'Test', premiered: null, ended: null, network: null, summary: null, imageUrl: null },
  episodes: [],
}

function ctx(sources: SourceInfo[]): ImportContext {
  return {
    show: { slug: 'test', name: 'Test', newsgroup: 'alt.tv.test', tvmazeQuery: 'test', liveWindowDays: 10 },
    showId: 1,
    liveWindowDays: 10,
    episodes: episodesFile,
    index: buildEpisodeIndex(episodesFile, {}),
    sources,
    workDir: 'data/work/sources/test',
    dryRun: true,
    force: false,
    log: () => {},
  }
}

describe('importUsenet', () => {
  test('is a no-op with a zeroed summary when no Usenet source is in scope', async () => {
    const forum: SourceInfo = { id: 5, key: 'southpark-official-forum', kind: 'forum', community_key: 'southpark.cc.com/forum' }
    const summary = await importUsenet(ctx([forum]))
    expect(summary.sources).toEqual({})
    expect(summary.conversations).toEqual({ inScope: 0, joinedLegacy: 0, newThreads: 0 })
    expect(summary.messages).toEqual({ inserted: 0, linked: 0, alreadyImported: 0, longBodies: 0, inheritedDates: 0 })
    expect(summary.memberships).toEqual({ primary: 0, additional: 0 })
    expect(summary.threadEpisodes).toEqual({ llm: 0, heuristic: 0, live: 0, retro: 0, unattributed: 0 })
    expect(summary.touchedThreads).toBe(0)
    expect(typeof summary.durationMs).toBe('number')
  })

  test('with an empty source list is likewise a no-op', async () => {
    const summary = await importUsenet(ctx([]))
    expect(summary.conversations.inScope).toBe(0)
    expect(summary.sources).toEqual({})
  })
})
