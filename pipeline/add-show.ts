// `pipeline add-show` — register a newsgroup, pull its archive, and resolve its
// TVMaze episodes immediately so a bad match surfaces here rather than mid-ingest.
import type { ShowConfig } from './lib/types'
import { buildContext, loadRegistry, saveRegistry } from './lib/context'
import { slugify } from './lib/text'
import { downloadArchive } from './download'
import { run as runEpisodes } from './stages/episodes'

export async function addShow(input: {
  newsgroup: string
  name: string
  slug?: string
  tvmazeQuery?: string
}): Promise<ShowConfig> {
  const slug = input.slug ?? slugify(input.name)
  const shows = loadRegistry()
  const existing = shows.find((s) => s.slug === slug || s.newsgroup === input.newsgroup)
  if (existing) {
    console.log(`[add-show] already registered: ${existing.slug} (${existing.newsgroup})`)
    return existing
  }

  await downloadArchive(input.newsgroup)

  const config: ShowConfig = {
    slug,
    name: input.name,
    newsgroup: input.newsgroup,
    tvmazeQuery: input.tvmazeQuery ?? input.name,
    liveWindowDays: 10,
  }
  saveRegistry([...shows, config])

  // Resolve episodes now (pins tvmazeId into the registry via the episodes stage).
  const ctx = buildContext(config, { force: false })
  await runEpisodes(ctx)

  return loadRegistry().find((s) => s.slug === slug) ?? config
}
