import { redirect, type LoaderFunctionArgs, type RouteObject } from 'react-router-dom'
import type { QueryClient } from '@tanstack/react-query'
import type { TRPCOptionsProxy } from '@trpc/tanstack-react-query'
import { authClient } from '~/lib/auth-client'
import { getBrowserClients } from '~/lib/trpc'
import type { Session } from '../../server/auth'
import type { AppRouter } from '../../server/router'
import { EpisodePage } from './episode'
import { RouteErrorBoundary } from './error-boundary'
import { HomePage } from './home'
import { Layout } from './layout'
import { PeoplePage } from './people'
import { PosterPage } from './poster'
import { SearchPage } from './search'
import { SeasonPage } from './season'
import { ShowPage } from './show'
import { ShowSourcesPage } from './show-sources'
import { SignInPage } from './sign-in'
import { SourcePage } from './source'
import { SourceRecordPage } from './source-record'
import { SourcesPage } from './sources'
import { ThreadPage } from './thread'

// Per-request context populated by entry-server.tsx and handed to loaders via
// createStaticHandler.query(req, { requestContext }). Only available SSR-side.
// On the client, loaders fall back to the browser singletons.
export type SsrLoaderContext = {
  session: Session | null
  queryClient: QueryClient
  trpc: TRPCOptionsProxy<AppRouter>
}

export type RootLoaderData = { session: Session | null }

type Clients = { queryClient: QueryClient; trpc: TRPCOptionsProxy<AppRouter> }

function clients(context: unknown): Clients {
  if (typeof window === 'undefined') {
    const { queryClient, trpc } = context as SsrLoaderContext
    return { queryClient, trpc }
  }
  const { queryClient, trpc } = getBrowserClients()
  return { queryClient, trpc }
}

async function fetchClientSession(): Promise<Session | null> {
  const { data, error } = await authClient.getSession()
  if (error || !data) return null
  return data as Session
}

function notFound(): Response {
  return new Response('Not Found', { status: 404 })
}

// tRPC NOT_FOUND arrives as TRPCError SSR-side (direct proxy) and as
// TRPCClientError in the browser (code under `data`). Either becomes a real 404.
function isNotFound(e: unknown): boolean {
  if (typeof e !== 'object' || e === null) return false
  if ('code' in e && e.code === 'NOT_FOUND') return true
  if ('data' in e && typeof e.data === 'object' && e.data !== null && 'code' in e.data) {
    return e.data.code === 'NOT_FOUND'
  }
  return false
}

// ensureQueryData throws on error (unlike prefetchQuery), so a missing show or
// episode surfaces here and renders the 404 boundary with the right status.
async function ensure<T>(promise: Promise<T>): Promise<T> {
  try {
    return await promise
  } catch (e) {
    if (isNotFound(e)) throw notFound()
    throw e
  }
}

function param(params: LoaderFunctionArgs['params'], name: string): string {
  const value = params[name]
  if (!value) throw notFound()
  return value
}

function intParam(params: LoaderFunctionArgs['params'], name: string): number {
  const n = Number(param(params, name))
  if (!Number.isInteger(n) || n < 1) throw notFound()
  return n
}

function optionalInt(value: string | null): number | undefined {
  if (value === null || value === '') return undefined
  const n = Number(value)
  return Number.isInteger(n) ? n : undefined
}

async function rootLoader({ context }: LoaderFunctionArgs): Promise<RootLoaderData> {
  if (typeof window === 'undefined') {
    return { session: (context as SsrLoaderContext).session }
  }
  return { session: await fetchClientSession() }
}

async function redirectIfSignedIn({ context }: LoaderFunctionArgs) {
  const session =
    typeof window === 'undefined'
      ? (context as SsrLoaderContext).session
      : await fetchClientSession()
  if (session) throw redirect('/')
  return null
}

async function homeLoader({ context }: LoaderFunctionArgs) {
  const { queryClient, trpc } = clients(context)
  await ensure(queryClient.ensureQueryData(trpc.shows.list.queryOptions()))
  return null
}

async function showLoader({ context, params }: LoaderFunctionArgs) {
  const { queryClient, trpc } = clients(context)
  const slug = param(params, 'show')
  await ensure(queryClient.ensureQueryData(trpc.shows.get.queryOptions({ slug })))
  await Promise.all([
    queryClient.ensureQueryData(trpc.shows.timeline.queryOptions({ slug })),
    queryClient.ensureQueryData(trpc.shows.phrases.queryOptions({ slug })),
    queryClient.ensureQueryData(trpc.shows.thenVsNow.queryOptions({ slug })),
  ])
  return null
}

async function seasonLoader({ context, params }: LoaderFunctionArgs) {
  const { queryClient, trpc } = clients(context)
  const slug = param(params, 'show')
  const season = intParam(params, 'n')
  const show = await ensure(queryClient.ensureQueryData(trpc.shows.get.queryOptions({ slug })))
  if (!show.seasons.some((s) => s.number === season)) throw notFound()
  await queryClient.ensureQueryData(trpc.episodes.list.queryOptions({ slug, season }))
  return null
}

async function episodeLoader({ context, params, request }: LoaderFunctionArgs) {
  const { queryClient, trpc } = clients(context)
  const slug = param(params, 'show')
  const episode = param(params, 'episode')
  const source = new URL(request.url).searchParams.get('source') ?? undefined
  const data = await ensure(
    queryClient.ensureQueryData(trpc.episodes.get.queryOptions({ slug, episode }))
  )
  const base = { episodeId: data.episode.id, filter: 'all', sort: 'size', source, cursor: 0, limit: 20 } as const
  await Promise.all([
    queryClient.ensureQueryData(trpc.threads.byEpisode.queryOptions({ ...base, relation: 'live' })),
    queryClient.ensureQueryData(trpc.threads.byEpisode.queryOptions({ ...base, relation: 'retro' })),
  ])
  return null
}

async function sourcesLoader({ context }: LoaderFunctionArgs) {
  const { queryClient, trpc } = clients(context)
  await ensure(queryClient.ensureQueryData(trpc.sources.list.queryOptions()))
  return null
}

async function sourceLoader({ context, params }: LoaderFunctionArgs) {
  const { queryClient, trpc } = clients(context)
  const key = param(params, 'key')
  await ensure(queryClient.ensureQueryData(trpc.sources.get.queryOptions({ key })))
  return null
}

async function sourceRecordLoader({ context, params }: LoaderFunctionArgs) {
  const { queryClient, trpc } = clients(context)
  const key = param(params, 'key')
  const recordId = param(params, 'recordId')
  await ensure(queryClient.ensureQueryData(trpc.sources.record.queryOptions({ key, recordId })))
  return null
}

async function showSourcesLoader({ context, params }: LoaderFunctionArgs) {
  const { queryClient, trpc } = clients(context)
  const slug = param(params, 'show')
  await ensure(queryClient.ensureQueryData(trpc.shows.get.queryOptions({ slug })))
  await ensure(queryClient.ensureQueryData(trpc.sources.forShow.queryOptions({ slug })))
  return null
}

async function threadLoader({ context, params }: LoaderFunctionArgs) {
  const { queryClient, trpc } = clients(context)
  const show = param(params, 'show')
  const slug = param(params, 'slug')
  await ensure(queryClient.ensureQueryData(trpc.threads.get.queryOptions({ show, slug })))
  return null
}

async function searchLoader({ context, params, request }: LoaderFunctionArgs) {
  const { queryClient, trpc } = clients(context)
  const slug = param(params, 'show')
  const url = new URL(request.url)
  const q = url.searchParams.get('q')?.trim() ?? ''
  await ensure(queryClient.ensureQueryData(trpc.shows.get.queryOptions({ slug })))
  if (q) {
    await queryClient.ensureQueryData(
      trpc.search.query.queryOptions({
        slug,
        q,
        season: optionalInt(url.searchParams.get('season')),
        episodeId: optionalInt(url.searchParams.get('episode')),
        yearFrom: optionalInt(url.searchParams.get('from')),
        yearTo: optionalInt(url.searchParams.get('to')),
        posterId: optionalInt(url.searchParams.get('poster')),
        cursor: optionalInt(url.searchParams.get('cursor')) ?? 0,
      })
    )
  }
  return null
}

async function peopleLoader({ context, params }: LoaderFunctionArgs) {
  const { queryClient, trpc } = clients(context)
  const slug = param(params, 'show')
  await ensure(queryClient.ensureQueryData(trpc.shows.get.queryOptions({ slug })))
  await Promise.all([
    queryClient.ensureQueryData(trpc.posters.top.queryOptions({ slug })),
    queryClient.ensureQueryData(trpc.posters.prophets.queryOptions({ slug })),
  ])
  return null
}

async function posterLoader({ context, params }: LoaderFunctionArgs) {
  const { queryClient, trpc } = clients(context)
  const slug = param(params, 'show')
  const id = intParam(params, 'id')
  await ensure(queryClient.ensureQueryData(trpc.shows.get.queryOptions({ slug })))
  await ensure(queryClient.ensureQueryData(trpc.posters.get.queryOptions({ id })))
  return null
}

export const routes: RouteObject[] = [
  {
    id: 'root',
    path: '/',
    Component: Layout,
    loader: rootLoader,
    ErrorBoundary: RouteErrorBoundary,
    children: [
      { index: true, Component: HomePage, loader: homeLoader },
      { path: 'sign-in', Component: SignInPage, loader: redirectIfSignedIn },
      // The global source catalog. Registered before `:show` so its static first
      // segment ranks above the dynamic show slug.
      {
        path: 'sources',
        children: [
          { index: true, Component: SourcesPage, loader: sourcesLoader },
          { path: ':key', Component: SourcePage, loader: sourceLoader },
          {
            path: ':key/records/:recordId',
            Component: SourceRecordPage,
            loader: sourceRecordLoader,
          },
        ],
      },
      {
        path: ':show',
        children: [
          { index: true, Component: ShowPage, loader: showLoader },
          { path: 'season/:n', Component: SeasonPage, loader: seasonLoader },
          { path: 'search', Component: SearchPage, loader: searchLoader },
          { path: 'people', Component: PeoplePage, loader: peopleLoader },
          { path: 'people/:id', Component: PosterPage, loader: posterLoader },
          { path: 'thread/:slug', Component: ThreadPage, loader: threadLoader },
          { path: 'sources', Component: ShowSourcesPage, loader: showSourcesLoader },
          // Static siblings above rank higher than this dynamic segment.
          { path: ':episode', Component: EpisodePage, loader: episodeLoader },
        ],
      },
    ],
  },
]
