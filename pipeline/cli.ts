// Ingest CLI.
//
//   bun run pipeline ingest <slug> [--from <stage>] [--only <stage,stage>] [--force]
//   bun run pipeline add-show <newsgroup> --name "<Show Name>" [--slug <slug>] [--tvmaze "<query>"] [--no-ingest]
//   bun run pipeline download <newsgroup>
//
// Stages run in order (see STAGES); each reads the previous checkpoint under
// data/work/<slug>/ and skips itself when its output exists unless --force.
import { parseArgs } from 'node:util'
import { buildContext, findShow } from './lib/context'
import { STAGES, type Stage, type StageName } from './lib/types'
import { addShow } from './add-show'
import { downloadArchive } from './download'

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    from: { type: 'string' },
    only: { type: 'string' },
    force: { type: 'boolean', default: false },
    name: { type: 'string' },
    slug: { type: 'string' },
    tvmaze: { type: 'string' },
    'no-ingest': { type: 'boolean', default: false },
  },
})

const [command, target] = positionals

function isStage(s: string): s is StageName {
  return (STAGES as readonly string[]).includes(s)
}

async function loadStage(name: StageName): Promise<Stage> {
  const mod: { run: Stage['run'] } = await import(`./stages/${name}`)
  return { name, run: mod.run }
}

export async function runStages(slug: string, opts: { from?: string; only?: string; force: boolean }) {
  const show = findShow(slug)
  const ctx = buildContext(show, { force: opts.force })

  let names: StageName[] = [...STAGES]
  if (opts.only) {
    names = opts.only.split(',').map((s) => {
      if (!isStage(s)) throw new Error(`unknown stage "${s}"`)
      return s
    })
  } else if (opts.from) {
    if (!isStage(opts.from)) throw new Error(`unknown stage "${opts.from}"`)
    names = STAGES.slice(STAGES.indexOf(opts.from))
  }

  for (const name of names) {
    const stage = await loadStage(name)
    const started = Date.now()
    ctx.log(`── ${name}`)
    await stage.run(ctx)
    ctx.log(`── ${name} done in ${((Date.now() - started) / 1000).toFixed(1)}s`)
  }
}

async function main() {
  switch (command) {
    case 'ingest': {
      if (!target) throw new Error('usage: pipeline ingest <slug>')
      await runStages(target, { from: values.from, only: values.only, force: values.force })
      return
    }
    case 'add-show': {
      if (!target || !values.name) throw new Error('usage: pipeline add-show <newsgroup> --name "<Show Name>"')
      const show = await addShow({
        newsgroup: target,
        name: values.name,
        slug: values.slug,
        tvmazeQuery: values.tvmaze,
      })
      if (!values['no-ingest']) await runStages(show.slug, { force: false })
      return
    }
    case 'download': {
      if (!target) throw new Error('usage: pipeline download <newsgroup>')
      await downloadArchive(target)
      return
    }
    default:
      throw new Error(`unknown command "${command ?? ''}" — expected ingest | add-show | download`)
  }
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e)
  process.exit(1)
})
