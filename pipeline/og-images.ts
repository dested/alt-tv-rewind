// Share-preview cards (og:image): one 1200×630 PNG per show plus a site card,
// rendered from live DB numbers in the paper theme (ui.md) and written to
// public/og/<slug>.png + public/og/site.png. Re-run after adding a show or a
// big reload: `bun run og`. Pages pick the image in src/lib/page-meta.ts.

import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { chromium } from '@playwright/test'
import pg from 'pg'
import { z } from 'zod'

const ROOT = path.resolve(import.meta.dirname, '..')
const OUT = path.join(ROOT, 'public', 'og')

const registrySchema = z.array(z.object({ slug: z.string(), name: z.string(), newsgroup: z.string() }))
const registry = registrySchema.parse(
  JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'shows.json'), 'utf8'))
)

const yearRow = z.object({ year: z.number(), posts: z.number() })
type Year = z.infer<typeof yearRow>

function font(file: string): string {
  return pathToFileURL(path.join(ROOT, 'node_modules', '@fontsource-variable', file)).href
}

const STYLE = `
@font-face { font-family: 'Newsreader'; src: url('${font('newsreader/files/newsreader-latin-opsz-normal.woff2')}') format('woff2'); font-weight: 200 800; }
@font-face { font-family: 'Inter'; src: url('${font('inter/files/inter-latin-wght-normal.woff2')}') format('woff2'); font-weight: 100 900; }
:root {
  --paper: oklch(0.965 0.012 85); --ink: oklch(0.2 0.02 60); --muted: oklch(0.47 0.02 60);
  --border: oklch(0.86 0.016 80); --brand: oklch(0.6 0.2 32); --link: oklch(0.42 0.11 245);
}
* { box-sizing: border-box; margin: 0; }
body { width: 1200px; height: 630px; background: var(--paper); color: var(--ink); font-family: 'Inter', system-ui; overflow: hidden; }
.card { height: 100%; border-top: 16px solid var(--brand); padding: 44px 72px 48px; display: flex; flex-direction: column; }
.mast { display: flex; align-items: baseline; justify-content: space-between; padding-bottom: 14px; border-bottom: 3px solid var(--ink); }
.mark { font-family: 'Newsreader', Georgia; font-weight: 600; font-size: 34px; letter-spacing: -0.02em; }
.group { font-size: 22px; color: var(--muted); }
h1 { font-family: 'Newsreader', Georgia; font-weight: 600; letter-spacing: -0.025em; line-height: 1; margin-top: 44px; }
.meta { font-size: 26px; color: var(--muted); margin-top: 22px; }
.meta b { color: var(--ink); font-weight: 600; }
.chart { margin-top: auto; display: flex; align-items: flex-end; gap: 4px; height: 120px; border-bottom: 1.5px solid var(--ink); }
.chart span { flex: 1; background: var(--brand); min-height: 2px; }
.years { display: flex; justify-content: space-between; font-size: 18px; color: var(--muted); margin-top: 8px; }
.lede { font-family: 'Newsreader', Georgia; font-size: 40px; line-height: 1.2; margin-top: 30px; max-width: 24em; }
.shows { margin-top: auto; font-family: 'Newsreader', Georgia; font-size: 28px; line-height: 1.5; color: var(--link); }
.shows span { white-space: nowrap; }
.shows i { font-style: normal; color: var(--border); padding: 0 4px; }
`

const esc = (s: string): string =>
  s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c)

function page(body: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><style>${STYLE}</style></head><body>${body}</body></html>`
}

function showCard(name: string, newsgroup: string, years: Year[]): string {
  const total = years.reduce((n, y) => n + y.posts, 0)
  const first = years[0]?.year
  const last = years.at(-1)?.year
  const max = Math.max(1, ...years.map((y) => y.posts))
  const size = name.length > 16 ? 96 : name.length > 11 ? 112 : 128
  const bars = years.map((y) => `<span style="height:${((y.posts / max) * 100).toFixed(1)}%"></span>`).join('')
  const span = first && last ? (first === last ? `${first}` : `${first}–${last}`) : ''
  return page(`<div class="card">
    <div class="mast"><span class="mark">alt.tv.rewind</span><span class="group">${esc(newsgroup)}</span></div>
    <h1 style="font-size:${size}px">${esc(name)}</h1>
    <p class="meta"><b>${total.toLocaleString('en-US')}</b> posts${span ? ` · ${span}` : ''} · what the newsgroup said the morning after</p>
    <div class="chart">${bars}</div>
    <div class="years"><span>${first ?? ''}</span><span>${last ?? ''}</span></div>
  </div>`)
}

function siteCard(names: string[], posts: number): string {
  return page(`<div class="card">
    <div class="mast"><span class="group">alt.tv.*</span><span class="group">${posts.toLocaleString('en-US')} posts</span></div>
    <h1 style="font-size:128px">alt.tv.rewind</h1>
    <p class="lede">What Usenet said the morning after every episode aired, lined up against the original air dates</p>
    <p class="shows">${names.map((n) => `<span>${esc(n)}</span>`).join(' <i>/</i> ')}</p>
  </div>`)
}

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL is not set')
  const db = new pg.Client({ connectionString: url })
  await db.connect()
  fs.mkdirSync(OUT, { recursive: true })

  const browser = await chromium.launch()
  const tab = await browser.newPage({ viewport: { width: 1200, height: 630 } })
  async function shoot(html: string, file: string): Promise<void> {
    await tab.setContent(html, { waitUntil: 'load' })
    await tab.evaluate(() => document.fonts.ready.then(() => true))
    await tab.screenshot({ path: path.join(OUT, file), type: 'png' })
    console.log(`og: public/og/${file}`)
  }

  try {
    let allPosts = 0
    for (const show of registry) {
      const { rows } = await db.query(
        `SELECT extract(year FROM dv.day)::int AS year, sum(dv.message_count)::int AS posts
         FROM daily_volume dv JOIN show s ON s.id = dv.show_id
         WHERE s.slug = $1 GROUP BY 1 ORDER BY 1`,
        [show.slug]
      )
      const years = z.array(yearRow).parse(rows)
      if (years.length === 0) {
        console.log(`og: skip ${show.slug} (no volume yet)`)
        continue
      }
      allPosts += years.reduce((n, y) => n + y.posts, 0)
      await shoot(showCard(show.name, show.newsgroup, years), `${show.slug}.png`)
    }
    await shoot(siteCard(registry.map((s) => s.name), allPosts), 'site.png')
  } finally {
    await browser.close()
    await db.end()
  }
}

await main()
