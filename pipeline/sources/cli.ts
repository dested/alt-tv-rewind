// `bun run pipeline sources <catalog|import|report> …` — the source-aware
// catalog and import commands (see plans/2026-09-21-source-integration-implementation.md).
//
//   sources catalog [--source a,b] [--dry-run]      inventory + screen + conversations + capsule extraction
//   sources import <show> [--source a,b] [--dry-run] [--force]   projection for one show, then stats
//   sources report                                  reconciled counts → data/work/sources/report.json
import { existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { ROOT } from '../lib/context'
import { SOURCES_WORK_DIR, type CatalogOpts } from './types'

export type SourcesArgs = {
  'dry-run': boolean
  source: string | undefined
  force: boolean
}

export const WORK_DIR = join(ROOT, SOURCES_WORK_DIR)

export async function runSources(positionals: string[], args: SourcesArgs): Promise<void> {
  const [sub, target] = positionals
  if (!existsSync(WORK_DIR)) mkdirSync(WORK_DIR, { recursive: true })
  const log = (msg: string): void => console.log(`[sources] ${msg}`)
  const sources = args.source ? args.source.split(',').map((s) => s.trim()) : undefined

  switch (sub) {
    case 'catalog': {
      const opts: CatalogOpts = { dryRun: args['dry-run'], log, ...(sources ? { sources } : {}) }
      const wants = (key: string): boolean => sources === undefined || sources.includes(key)
      const usenetKeys = [
        'usenet-alt-tv-familyguy',
        'usenet-alt-tv-simpsons-itchy-scratchy',
        'usenet-rec-arts-animation',
        'usenet-alt-tv-game-shows',
        'usenet-rec-arts-tv',
      ]
      if (usenetKeys.some(wants)) {
        const { catalogUsenet } = await import('./catalog-usenet')
        await catalogUsenet(opts)
      }
      if (wants('southpark-official-forum')) {
        const { catalogForum } = await import('./catalog-forum')
        await catalogForum(opts)
      }
      if (wants('simpsons-archive-capsules')) {
        const { catalogCapsules } = await import('./catalog-capsules')
        await catalogCapsules(opts)
      }
      return
    }
    case 'import': {
      if (!target) throw new Error('usage: pipeline sources import <show>')
      const { importShow } = await import('./import')
      await importShow({ show: target, dryRun: args['dry-run'], force: args.force, log, ...(sources ? { sources } : {}) })
      return
    }
    case 'report': {
      const { writeReport } = await import('./report')
      await writeReport(log)
      return
    }
    default:
      throw new Error(`unknown sources command "${sub ?? ''}" — expected catalog | import | report`)
  }
}
