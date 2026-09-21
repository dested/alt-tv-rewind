// Lookup structures over an EpisodesFile: by key, by normalized title (so a
// two-parter's two records share one title bucket), and a flat list of match
// terms (episode titles + curated aliases) the scorer runs against thread text.
import type { AliasesFile, EpisodeRecord, EpisodesFile } from './types'
import { normalizeTitle } from './text'

export type Term = {
  phrase: string // lowercased; normalized title for source 'title'
  keys: string[] // episode keys this term points at (>1 for two-parters)
  source: 'title' | 'alias'
  singleWord: boolean // no whitespace — matched more conservatively by the scorer
}

export type EpisodeIndex = {
  byKey: Map<string, EpisodeRecord>
  byNormTitle: Map<string, EpisodeRecord[]>
  terms: Term[]
  resolveTitle: (title: string) => EpisodeRecord[]
}

export function airDateMs(ep: EpisodeRecord): number {
  return Date.parse(ep.airDate + 'T00:00:00Z')
}

export function buildEpisodeIndex(file: EpisodesFile, aliases: AliasesFile): EpisodeIndex {
  const byKey = new Map<string, EpisodeRecord>()
  const byNormTitle = new Map<string, EpisodeRecord[]>()
  for (const ep of file.episodes) {
    byKey.set(ep.key, ep)
    const nt = normalizeTitle(ep.title)
    const bucket = byNormTitle.get(nt)
    if (bucket) bucket.push(ep)
    else byNormTitle.set(nt, [ep])
  }

  const resolveTitle = (title: string): EpisodeRecord[] => byNormTitle.get(normalizeTitle(title)) ?? []

  const terms: Term[] = []
  for (const [nt, eps] of byNormTitle) {
    terms.push({ phrase: nt, keys: eps.map((e) => e.key), source: 'title', singleWord: !nt.includes(' ') })
  }

  // Alias resolution must fail loudly: a title typo in aliases.json points at no
  // episode and would silently drop the alias otherwise.
  const unresolved: string[] = []
  for (const [title, phrases] of Object.entries(aliases)) {
    const eps = resolveTitle(title)
    if (eps.length === 0) {
      unresolved.push(title)
      continue
    }
    const keys = eps.map((e) => e.key)
    for (const phrase of phrases) {
      const p = phrase.toLowerCase().trim()
      terms.push({ phrase: p, keys, source: 'alias', singleWord: !p.includes(' ') })
    }
  }
  if (unresolved.length > 0) {
    throw new Error(
      `aliases.json: ${unresolved.length} title(s) match no episode — ${unresolved
        .map((t) => JSON.stringify(t))
        .join(', ')}`,
    )
  }

  return { byKey, byNormTitle, terms, resolveTitle }
}
