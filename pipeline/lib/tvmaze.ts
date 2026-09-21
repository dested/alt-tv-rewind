// TVMaze client + normalizer. Only the subset of fields the pipeline stores is
// modeled; unknown keys are dropped by zod. Shapes verified against a live fetch
// of https://api.tvmaze.com/shows/530?embed=episodes.
import { z } from 'zod'
import { EpisodesFile, type EpisodeRecord } from './types'
import { slugify, stripHtml } from './text'

const TvmazeImage = z.object({ original: z.string() })
const TvmazeRating = z.object({ average: z.number().nullable() })
const TvmazeNamed = z.object({ name: z.string() })

const TvmazeEpisode = z.object({
  id: z.number().int(),
  name: z.string(),
  season: z.number().int(),
  number: z.number().int().nullable(), // null for specials
  type: z.string(),
  airdate: z.string(), // may be ""
  airtime: z.string().nullish(),
  airstamp: z.string().nullish(),
  runtime: z.number().int().nullable(),
  summary: z.string().nullable(),
  image: TvmazeImage.nullable(),
  rating: TvmazeRating.nullish(),
})

const TvmazeShow = z.object({
  id: z.number().int(),
  name: z.string(),
  premiered: z.string().nullable(),
  ended: z.string().nullable(),
  network: TvmazeNamed.nullable(),
  webChannel: TvmazeNamed.nullable(),
  summary: z.string().nullable(),
  image: TvmazeImage.nullable(),
  rating: TvmazeRating.nullish(),
  _embedded: z.object({ episodes: z.array(TvmazeEpisode) }),
})
export type TvmazeShow = z.infer<typeof TvmazeShow>

export class TvmazeNotFound extends Error {
  constructor(url: string) {
    super(`TVMaze 404 (not found): ${url}`)
    this.name = 'TvmazeNotFound'
  }
}

const BASE = 'https://api.tvmaze.com'

async function fetchShowJson(url: string): Promise<unknown> {
  const delays = [1000, 2000, 4000] // backoff for 429/5xx, up to 3 retries
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url)
    if (res.status === 404) throw new TvmazeNotFound(url)
    if (res.ok) return res.json()
    const delay = delays[attempt]
    if ((res.status === 429 || res.status >= 500) && delay !== undefined) {
      await new Promise((resolve) => setTimeout(resolve, delay))
      continue
    }
    throw new Error(`TVMaze ${res.status} ${res.statusText}: ${url}`)
  }
}

export async function fetchShowByQuery(q: string): Promise<TvmazeShow> {
  const url = `${BASE}/singlesearch/shows?q=${encodeURIComponent(q)}&embed=episodes`
  return TvmazeShow.parse(await fetchShowJson(url))
}

export async function fetchShowById(id: number): Promise<TvmazeShow> {
  const url = `${BASE}/shows/${id}?embed=episodes`
  return TvmazeShow.parse(await fetchShowJson(url))
}

const pad2 = (n: number): string => String(n).padStart(2, '0')

// Flatten a TVMaze show into the committed EpisodesFile. Specials (no episode
// number) and episodes with no air date are dropped; the caller derives the
// skipped count from the input/output lengths.
export function normalizeEpisodes(raw: TvmazeShow): EpisodesFile {
  const episodes: EpisodeRecord[] = []
  for (const ep of raw._embedded.episodes) {
    if (ep.number === null || !ep.airdate) continue
    const key = `S${pad2(ep.season)}E${pad2(ep.number)}`
    episodes.push({
      key,
      slug: `${key.toLowerCase()}-${slugify(ep.name)}`,
      season: ep.season,
      number: ep.number,
      title: ep.name,
      airDate: ep.airdate,
      airStamp: ep.airstamp ?? null,
      runtime: ep.runtime,
      summary: ep.summary ? stripHtml(ep.summary) : null,
      imageUrl: ep.image?.original ?? null,
      tvmazeId: ep.id,
      rating: ep.rating?.average ?? null,
    })
  }
  episodes.sort((a, b) => a.season - b.season || a.number - b.number)
  return EpisodesFile.parse({
    fetchedAt: new Date().toISOString(),
    show: {
      tvmazeId: raw.id,
      name: raw.name,
      premiered: raw.premiered,
      ended: raw.ended,
      network: raw.network?.name ?? raw.webChannel?.name ?? null,
      summary: raw.summary ? stripHtml(raw.summary) : null,
      imageUrl: raw.image?.original ?? null,
    },
    episodes,
  })
}
