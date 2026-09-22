// Map a Simpsons Archive capsule to an episode. Two signals, in order:
//   1. the document's printed original-airdate line → the episode with that date
//   2. the capsule title (production-code prefix stripped) → episode by title
// Revision and HTML-conversion dates are never used: they describe the document,
// not the broadcast (see plans/2026-09-21-capsule-provenance.md).
import type { EpisodeIndex } from '../lib/episode-index'
import type { EpisodeRecord } from '../lib/types'
import { normalizeTitle } from '../lib/text'

const MONTHS: Record<string, number> = {
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  oct: 10,
  nov: 11,
  dec: 12,
}

// "Original airdate in N.A.: 8-Jan-95" / "Airdate: 6-Jan-2002". The clock-free
// day is all these documents carry; a 2-digit year is disambiguated by the
// show's run (1989 première onward), never by a platform default.
const AIRDATE = /(?:original\s+airdate|airdate)[^:\n]*:\s*(\d{1,2})-([A-Za-z]{3})-(\d{2,4})/i

export function parseCapsuleAirDate(body: string): string | null {
  const m = body.match(AIRDATE)
  if (!m) return null
  const dayS = m[1]
  const monS = m[2]
  const yearS = m[3]
  if (dayS === undefined || monS === undefined || yearS === undefined) return null
  const mon = MONTHS[monS.toLowerCase()]
  if (mon === undefined) return null
  const day = parseInt(dayS, 10)
  if (day < 1 || day > 31) return null
  let year: number
  if (yearS.length <= 2) {
    const yy = parseInt(yearS, 10)
    if (yy >= 89 && yy <= 99) year = 1900 + yy
    else if (yy <= 30) year = 2000 + yy
    else return null // outside the show's run — an unusable 2-digit year
  } else {
    year = parseInt(yearS, 10)
  }
  const mm = String(mon).padStart(2, '0')
  const dd = String(day).padStart(2, '0')
  return `${year}-${mm}-${dd}`
}

export type CapsuleEpisodeMethod = 'capsule-airdate' | 'capsule-title'

export type CapsuleEpisodeResolution = {
  episodeKey: string | null
  method: CapsuleEpisodeMethod | null
  reason: string | null
  fallback?: boolean // matched only after &/"and" normalization (lower confidence)
}

// Production-code prefix printed on some titles: "[2F09] Homer the Great".
const CODE_PREFIX = /^\[[0-9A-Za-z]+\]\s*/

function buildByAirDate(index: EpisodeIndex): Map<string, EpisodeRecord[]> {
  const byAirDate = new Map<string, EpisodeRecord[]>()
  for (const ep of index.byKey.values()) {
    const bucket = byAirDate.get(ep.airDate)
    if (bucket) bucket.push(ep)
    else byAirDate.set(ep.airDate, [ep])
  }
  return byAirDate
}

// Aggressive title key: normalize, unify "&"/"and", then drop the standalone
// word "and" and all whitespace. Collapses "Itchy & Scratchy & Marge" and
// "Itchy and Scratchy and Marge", and "…Garage and Three…" / "…Garage, Three…".
function fallbackKey(title: string): string {
  return normalizeTitle(title)
    .replace(/&/g, 'and')
    .replace(/\band\b/g, '')
    .replace(/\s+/g, '')
}

function resolveByTitle(title: string, index: EpisodeIndex): CapsuleEpisodeResolution {
  const clean = title.replace(CODE_PREFIX, '').trim()
  const eps = index.resolveTitle(clean)
  const first = eps[0]
  if (eps.length === 1 && first !== undefined) {
    return { episodeKey: first.key, method: 'capsule-title', reason: null }
  }
  // Fallback: a unique match after collapsing "&"/"and" differences.
  const target = fallbackKey(clean)
  if (target !== '') {
    const matches: EpisodeRecord[] = []
    for (const ep of index.byKey.values()) if (fallbackKey(ep.title) === target) matches.push(ep)
    const only = matches[0]
    if (matches.length === 1 && only !== undefined) {
      return { episodeKey: only.key, method: 'capsule-title', reason: null, fallback: true }
    }
  }
  return { episodeKey: null, method: null, reason: 'unresolved_episode' }
}

export function resolveCapsuleEpisode(
  rec: { title: string; body: string; productionCode: string | null },
  index: EpisodeIndex
): CapsuleEpisodeResolution {
  const airDate = parseCapsuleAirDate(rec.body)
  if (airDate !== null) {
    const eps = buildByAirDate(index).get(airDate) ?? []
    const first = eps[0]
    if (eps.length === 1 && first !== undefined) {
      return { episodeKey: first.key, method: 'capsule-airdate', reason: null }
    }
    if (eps.length > 1) {
      // A double airing: keep the one whose title matches, else it is ambiguous.
      const wantTitle = normalizeTitle(rec.title.replace(CODE_PREFIX, ''))
      const matches = eps.filter((e) => normalizeTitle(e.title) === wantTitle)
      const only = matches[0]
      if (matches.length === 1 && only !== undefined) {
        return { episodeKey: only.key, method: 'capsule-airdate', reason: null }
      }
      return { episodeKey: null, method: null, reason: 'ambiguous_airdate' }
    }
    // Airdate parsed but no episode carries it: fall back to the title.
    return resolveByTitle(rec.title, index)
  }
  return resolveByTitle(rec.title, index)
}
