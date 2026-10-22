import fs from 'node:fs'
import path from 'node:path'
import type * as express from 'express'
import { dehydrate, QueryClient, type DehydratedState } from '@tanstack/react-query'
import { createTRPCClient, httpBatchLink } from '@trpc/client'
import { createTRPCOptionsProxy } from '@trpc/tanstack-react-query'
import ReactDomServer from 'react-dom/server'
import { StaticRouterProvider, createStaticHandler, createStaticRouter } from 'react-router-dom'
import { auth, type Session } from '../server/auth'
import { env } from '../server/env'
import { appRouter } from '../server/router'
import App from './App'
import { routes, type SsrLoaderContext } from './app/routes'
import { DEFAULT_META, isMetaData, renderHead, SITE_IMAGE } from './lib/page-meta'

// A show added after the last `bun run og` has no card yet; use the site one
// rather than hand unfurlers a 404. Built output first, then the dev public dir.
const STATIC_DIRS = [path.resolve('dist/client'), path.resolve('public')]
const staticSeen = new Map<string, boolean>()
function hasStatic(file: string): boolean {
  let hit = staticSeen.get(file)
  if (hit === undefined) {
    hit = STATIC_DIRS.some((dir) => fs.existsSync(path.join(dir, file)))
    staticSeen.set(file, hit)
  }
  return hit
}

export async function render(req: express.Request): Promise<{
  html: string
  head: string
  status: number
  session: Session | null
  dehydratedState: DehydratedState
}> {
  const fetchRequest = expressToFetch(req)

  const session = await auth.api.getSession({ headers: fetchRequest.headers })

  const queryClient = new QueryClient({
    defaultOptions: { queries: { staleTime: 60_000 } },
  })

  const trpcServer = createTRPCOptionsProxy({
    router: appRouter,
    ctx: { session },
    queryClient,
  })

  const { query, dataRoutes } = createStaticHandler(routes)
  const ssrContext: SsrLoaderContext = { session, queryClient, trpc: trpcServer }
  const routerContext = await query(fetchRequest, { requestContext: ssrContext })

  if (routerContext instanceof Response) throw routerContext

  const router = createStaticRouter(dataRoutes, routerContext)

  // Loopback tRPC client for any non-prefetched query that runs during render.
  // Prefetched queries land in queryClient cache and won't hit this.
  const cookieHeader = req.headers.cookie
  const trpcClient = createTRPCClient<typeof appRouter>({
    links: [
      httpBatchLink({
        url: `http://localhost:${process.env.PORT ?? 7485}/api/trpc`,
        headers: () => (cookieHeader ? { cookie: cookieHeader } : {}),
      }),
    ],
  })

  const html = ReactDomServer.renderToString(
    <App queryClient={queryClient} trpcClient={trpcClient} dehydratedState={null}>
      <StaticRouterProvider router={router} context={routerContext} />
    </App>
  )

  // The deepest matched route that returned `{ meta }` names the page.
  const found =
    routerContext.matches
      .map((m) => routerContext.loaderData[m.route.id])
      .filter(isMetaData)
      .at(-1)?.meta ?? DEFAULT_META
  const meta = hasStatic(found.image) ? found : { ...found, image: SITE_IMAGE }
  const pathname = new URL(fetchRequest.url).pathname

  // statusCode reflects loader-thrown Responses and unmatched-route 404s, so
  // the server returns the right HTTP status (not a blanket 200).
  return {
    html,
    head: renderHead(meta, env.BETTER_AUTH_URL, pathname),
    status: routerContext.statusCode,
    session,
    dehydratedState: dehydrate(queryClient),
  }
}

function expressToFetch(req: express.Request): Request {
  const origin = `${req.protocol}://${req.get('host')}`
  const url = new URL(req.originalUrl || req.url, origin)
  const controller = new AbortController()
  req.on('close', () => controller.abort())

  const headers = new Headers()
  for (const [key, values] of Object.entries(req.headers)) {
    if (!values) continue
    if (Array.isArray(values)) {
      for (const v of values) headers.append(key, v)
    } else {
      headers.set(key, values)
    }
  }

  const init: RequestInit = {
    method: req.method,
    headers,
    signal: controller.signal,
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') init.body = req.body

  return new Request(url.href, init)
}
