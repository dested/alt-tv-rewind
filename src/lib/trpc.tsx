import { QueryClient } from '@tanstack/react-query'
import { createTRPCClient, httpBatchLink, type TRPCClient } from '@trpc/client'
import {
  createTRPCContext,
  createTRPCOptionsProxy,
  type TRPCOptionsProxy,
} from '@trpc/tanstack-react-query'
import type { AppRouter } from '../../server/router'

export const { TRPCProvider, useTRPC } = createTRPCContext<AppRouter>()

export type BrowserClients = {
  queryClient: QueryClient
  trpcClient: TRPCClient<AppRouter>
  trpc: TRPCOptionsProxy<AppRouter>
}

let browserClients: BrowserClients | undefined

// Module singletons for the browser, created lazily so importing this file
// during SSR (routes.tsx is shared) allocates nothing. Loaders use `trpc` +
// `queryClient` to prefetch; index.tsx feeds the same instances to <App>.
export function getBrowserClients(): BrowserClients {
  if (typeof window === 'undefined') {
    throw new Error('getBrowserClients() is browser-only; SSR uses entry-server.tsx')
  }
  browserClients ??= createBrowserClients()
  return browserClients
}

function createBrowserClients(): BrowserClients {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { staleTime: 60_000 } },
  })
  const trpcClient = createTRPCClient<AppRouter>({
    links: [
      httpBatchLink({
        url: '/api/trpc',
        fetch(url, options) {
          return fetch(url, { ...options, credentials: 'include' })
        },
      }),
    ],
  })
  const trpc = createTRPCOptionsProxy<AppRouter>({ client: trpcClient, queryClient })
  return { queryClient, trpcClient, trpc }
}
