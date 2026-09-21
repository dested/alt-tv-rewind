// Stage: episodes — resolve the show on TVMaze and snapshot its episode list to
// data/shows/<slug>/episodes.json. Also seeds empty aliases.json / phrases.json.
import { existsSync, writeFileSync } from 'node:fs'
import type { Stage } from '../lib/types'
import { fetchShowById, fetchShowByQuery, normalizeEpisodes } from '../lib/tvmaze'
import { loadRegistry, saveRegistry } from '../lib/context'
import { writeJson } from '../lib/checkpoint'

function ensureFile(path: string, contents: string): void {
  if (!existsSync(path)) writeFileSync(path, contents)
}

export const run: Stage['run'] = async (ctx) => {
  if (existsSync(ctx.paths.episodesFile) && !ctx.force) {
    ctx.log('episodes: cached')
    return
  }

  const raw = ctx.show.tvmazeId
    ? await fetchShowById(ctx.show.tvmazeId)
    : await fetchShowByQuery(ctx.show.tvmazeQuery)
  const file = normalizeEpisodes(raw)
  writeJson(ctx.paths.episodesFile, file)

  // Pin the resolved id so re-runs are deterministic and don't re-query by name.
  if (ctx.show.tvmazeId === undefined) {
    const shows = loadRegistry()
    const entry = shows.find((s) => s.slug === ctx.show.slug)
    if (entry) {
      entry.tvmazeId = file.show.tvmazeId
      saveRegistry(shows)
      ctx.show.tvmazeId = file.show.tvmazeId
    }
  }

  ensureFile(ctx.paths.aliasesFile, '{}\n')
  ensureFile(ctx.paths.phrasesFile, '[]\n')

  const seasonNums = file.episodes.map((e) => e.season)
  const minS = Math.min(...seasonNums)
  const maxS = Math.max(...seasonNums)
  const skipped = raw._embedded.episodes.length - file.episodes.length
  ctx.log(
    `resolved ${file.show.name} → tvmaze ${file.show.tvmazeId}: ${file.episodes.length} episodes, ` +
      `S${minS}..S${maxS}, ${file.show.premiered ?? '?'}..${file.show.ended ?? '?'}, ${skipped} specials skipped`,
  )
}
