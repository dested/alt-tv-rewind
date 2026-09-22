// `pipeline sources import <show>` — project cataloged, accepted records into
// the serving tables for one show, then recompute that show's statistics.
// Usenet conversations and native forum topics have their own projections;
// capsule documents are never projected (they stay metadata + original link).
// Idempotent: a re-run inserts nothing new for unchanged inputs.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'
import { buildContext, findShow } from '../lib/context'
import { withClient } from '../lib/db'
import { AliasesFile, EpisodesFile, type ShowConfig } from '../lib/types'
import { buildEpisodeIndex, type EpisodeIndex } from '../lib/episode-index'
import { writeJson } from '../lib/checkpoint'
import { run as runStats } from '../stages/stats'
import { WORK_DIR } from './cli'
import type { ImportOpts } from './types'

const ShowRow = z.object({ id: z.number().int(), live_window_days: z.number().int() })
const SourceRow = z.object({
  id: z.number().int(),
  key: z.string(),
  kind: z.enum(['usenet', 'forum', 'capsule']),
  community_key: z.string(),
})
export type SourceInfo = z.infer<typeof SourceRow>

export type ImportContext = {
  show: ShowConfig
  showId: number
  liveWindowDays: number
  episodes: EpisodesFile
  index: EpisodeIndex
  sources: SourceInfo[] // sources with accepted/context dispositions for this show (filtered by opts.sources)
  workDir: string // data/work/sources/<show>/ — legacy-format checkpoints for classify/enrich live here
  dryRun: boolean
  force: boolean
  log: (msg: string) => void
}

// Same rollup the legacy loader does in its last step, for every archive of
// the show that belongs to a cataloged (non-legacy) source.
async function rollupArchives(showId: number): Promise<void> {
  await withClient(async (c) => {
    await c.query(
      `UPDATE archive a SET
         message_count = (SELECT count(*) FROM message WHERE archive_id = a.id),
         thread_count  = (SELECT count(*) FROM thread  WHERE archive_id = a.id),
         spam_count    = (SELECT count(*) FROM message WHERE archive_id = a.id AND is_spam),
         first_post_at = (SELECT min(posted_at) FROM message WHERE archive_id = a.id),
         last_post_at  = (SELECT max(posted_at) FROM message WHERE archive_id = a.id)
       FROM source s
       WHERE s.id = a.source_id AND NOT s.legacy AND a.show_id = $1`,
      [showId]
    )
  })
}

export async function importShow(opts: ImportOpts): Promise<void> {
  const show = findShow(opts.show)
  const stageCtx = buildContext(show, { force: opts.force })
  const episodes = EpisodesFile.parse(JSON.parse(readFileSync(stageCtx.paths.episodesFile, 'utf8')))
  const aliases = AliasesFile.parse(JSON.parse(readFileSync(stageCtx.paths.aliasesFile, 'utf8')))
  const index = buildEpisodeIndex(episodes, aliases)

  const { showId, liveWindowDays, sources } = await withClient(async (c) => {
    const showRes = await c.query('SELECT id, live_window_days FROM show WHERE slug = $1', [show.slug])
    const showRow = showRes.rows[0]
    if (showRow === undefined) throw new Error(`show "${show.slug}" is not loaded — run the legacy ingest first`)
    const s = ShowRow.parse(showRow)
    const srcRes = await c.query(
      `SELECT DISTINCT s.id, s.key, s.kind, s.community_key
       FROM source s
       JOIN source_record r ON r.source_id = s.id
       JOIN record_show rs ON rs.record_id = r.id
       WHERE rs.show_id = $1 AND rs.status IN ('accepted', 'context')
       ORDER BY s.id`,
      [s.id]
    )
    const all = (srcRes.rows as unknown[]).map((r) => SourceRow.parse(r))
    const wanted = opts.sources
    return {
      showId: s.id,
      liveWindowDays: s.live_window_days,
      sources: wanted ? all.filter((x) => wanted.includes(x.key)) : all,
    }
  })
  if (sources.length === 0) {
    opts.log(`${show.slug}: no cataloged sources with accepted records — run \`pipeline sources catalog\` first`)
    return
  }

  const ctx: ImportContext = {
    show,
    showId,
    liveWindowDays,
    episodes,
    index,
    sources,
    workDir: join(WORK_DIR, show.slug),
    dryRun: opts.dryRun,
    force: opts.force,
    log: (m) => opts.log(`${show.slug}: ${m}`),
  }
  ctx.log(`sources: ${sources.map((s) => `${s.key} (${s.kind})`).join(', ')}${opts.dryRun ? ' [dry run]' : ''}`)

  const summary: Record<string, unknown> = { show: show.slug, dryRun: opts.dryRun, startedAt: new Date().toISOString() }
  if (sources.some((s) => s.kind === 'usenet')) {
    const { importUsenet } = await import('./import-usenet')
    summary['usenet'] = await importUsenet(ctx)
  }
  if (sources.some((s) => s.kind === 'forum')) {
    const { importForum } = await import('./import-forum')
    summary['forum'] = await importForum(ctx)
  }
  const capsules = sources.filter((s) => s.kind === 'capsule')
  if (capsules.length > 0) {
    // Documents are linked to episodes through record_show only; nothing is projected.
    summary['capsules'] = await withClient(async (c) => {
      if (!opts.dryRun) {
        await c.query(
          `UPDATE record_show rs SET import_status = 'skipped'
           FROM source_record r WHERE r.id = rs.record_id AND rs.show_id = $1 AND r.kind = 'compiled_document' AND rs.import_status = 'pending'`,
          [showId]
        )
      }
      const res = await c.query(
        `SELECT count(*) FILTER (WHERE rs.status = 'accepted')::int AS linked,
                count(*) FILTER (WHERE rs.status = 'needs_review')::int AS unresolved
         FROM record_show rs JOIN source_record r ON r.id = rs.record_id
         WHERE rs.show_id = $1 AND r.kind = 'compiled_document'`,
        [showId]
      )
      return z.object({ linked: z.number().int(), unresolved: z.number().int() }).parse(res.rows[0])
    })
    ctx.log(`capsules: ${JSON.stringify(summary['capsules'])} (metadata only, not projected)`)
  }

  if (!opts.dryRun) {
    await rollupArchives(showId)
    ctx.log('recomputing stats')
    await runStats(stageCtx)
  }
  summary['finishedAt'] = new Date().toISOString()
  writeJson(join(WORK_DIR, `import-${show.slug}-summary.json`), summary)
  ctx.log(`summary → data/work/sources/import-${show.slug}-summary.json`)
}
