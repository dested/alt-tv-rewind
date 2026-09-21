import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { ShowRegistry, type ShowConfig, type StageContext } from './types'

export const ROOT = resolve(import.meta.dir, '..', '..')
export const DATA_DIR = join(ROOT, 'data')
export const REGISTRY_FILE = join(DATA_DIR, 'shows.json')

export function loadRegistry(): ShowConfig[] {
  return ShowRegistry.parse(JSON.parse(readFileSync(REGISTRY_FILE, 'utf8')))
}

export function saveRegistry(shows: ShowConfig[]): void {
  writeFileSync(REGISTRY_FILE, JSON.stringify(shows, null, 2) + '\n')
}

export function findShow(slug: string): ShowConfig {
  const show = loadRegistry().find((s) => s.slug === slug)
  if (!show) throw new Error(`unknown show "${slug}" — not in data/shows.json`)
  return show
}

export function buildContext(show: ShowConfig, opts: { force: boolean }): StageContext {
  const showDir = join(DATA_DIR, 'shows', show.slug)
  const work = join(DATA_DIR, 'work', show.slug)
  for (const dir of [showDir, work]) if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return {
    show,
    paths: {
      archive: join(DATA_DIR, 'archives', `${show.newsgroup}.mbox`),
      work,
      showDir,
      episodesFile: join(showDir, 'episodes.json'),
      aliasesFile: join(showDir, 'aliases.json'),
      phrasesFile: join(showDir, 'phrases.json'),
    },
    force: opts.force,
    log: (msg) => console.log(`[${show.slug}] ${msg}`),
  }
}
