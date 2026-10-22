import type { RouterOutputs } from '~/lib/api-types'
import { episodeCode, formatAirDate, formatDate, plural } from '~/lib/format'

// Per-page <title> and share-preview text. Loaders return `{ meta }`; the SSR
// path writes it into <head> (entry-server → `<!--app-head-->`), and Layout
// keeps document.title in step on client navigation.

export type PageMeta = { title: string; description: string }

export const SITE = 'alt.tv.rewind'

export const DEFAULT_META: PageMeta = {
  title: SITE,
  description:
    'What alt.tv.* Usenet said the morning after every episode aired — Seinfeld, The Simpsons, Friends and more, lined up against the original air dates.',
}

export function isMetaData(data: unknown): data is { meta: PageMeta } {
  if (typeof data !== 'object' || data === null || !('meta' in data)) return false
  const meta = data.meta
  return (
    typeof meta === 'object' &&
    meta !== null &&
    'title' in meta &&
    typeof meta.title === 'string' &&
    'description' in meta &&
    typeof meta.description === 'string'
  )
}

function titled(...parts: string[]): string {
  return [...parts, SITE].join(' — ')
}

// Share previews cut off around 160–200 characters; end on a word.
function clip(text: string, max = 200): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  if (flat.length <= max) return flat
  const cut = flat.slice(0, max - 1)
  const space = cut.lastIndexOf(' ')
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,;:.—-]+$/, '')}…`
}

type Show = RouterOutputs['shows']['get']
type Episode = RouterOutputs['episodes']['get']
type Thread = RouterOutputs['threads']['get']['thread']

export function showMeta(data: Show): PageMeta {
  const group = data.archive?.newsgroup ?? 'Usenet'
  return {
    title: titled(data.show.name),
    description: `What ${group} said about every episode of ${data.show.name}, the morning after it aired and in the years since.`,
  }
}

export function seasonMeta(data: Show, season: number): PageMeta {
  return {
    title: titled(`${data.show.name} season ${season}`),
    description: `Every episode of ${data.show.name} season ${season}, ranked by how much ${data.archive?.newsgroup ?? 'Usenet'} had to say about it.`,
  }
}

export function episodeMeta(data: Episode): PageMeta {
  const ep = data.episode
  const code = episodeCode(ep.seasonNumber, ep.number)
  const reaction =
    ep.liveThreadCount > 0
      ? ` ${plural(ep.liveThreadCount, 'thread')} and ${plural(ep.liveMessageCount, 'post')} in the days after.`
      : ''
  const lead = `What Usenet said the morning after ${data.show.name} ${code} “${ep.title}” aired on ${formatAirDate(ep.airDate)}.`
  return {
    title: titled(`“${ep.title}”`, `${data.show.name} ${code}`),
    description: clip(ep.recap ?? `${lead}${reaction}`),
  }
}

export function threadMeta(thread: Thread): PageMeta {
  const ep = thread.episodes.find((e) => e.isPrimary) ?? null
  const where = ep
    ? `${thread.showName} ${episodeCode(ep.seasonNumber, ep.number)} “${ep.title}”`
    : thread.showName
  const fallback = `${plural(thread.messageCount, 'post')} about ${where}, starting ${formatDate(thread.startedAt)}.`
  return {
    title: titled(thread.subject, thread.showName),
    description: clip(thread.pullQuote ? `“${thread.pullQuote}” — ${fallback}` : (thread.summary ?? fallback)),
  }
}

export function simpleMeta(title: string, description: string): PageMeta {
  return { title: titled(title), description: clip(description) }
}

const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }
const escape = (s: string): string => s.replace(/[&<>"]/g, (c) => ESCAPES[c] ?? c)

export function renderHead(meta: PageMeta): string {
  const t = escape(meta.title)
  const d = escape(meta.description)
  return [
    `<title>${t}</title>`,
    `<meta name="description" content="${d}" />`,
    `<meta property="og:site_name" content="${SITE}" />`,
    `<meta property="og:title" content="${t}" />`,
    `<meta property="og:description" content="${d}" />`,
    `<meta property="og:type" content="website" />`,
    `<meta name="twitter:card" content="summary" />`,
    `<meta name="twitter:title" content="${t}" />`,
    `<meta name="twitter:description" content="${d}" />`,
  ].join('\n    ')
}
