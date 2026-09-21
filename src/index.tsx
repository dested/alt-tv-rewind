import ReactDOM from 'react-dom/client'
import { type DehydratedState } from '@tanstack/react-query'
import { RouterProvider, createBrowserRouter } from 'react-router-dom'
import App from './App'
import { routes } from './app/routes'
import { getBrowserClients } from '~/lib/trpc'

declare global {
  interface Window {
    __SSR_STATE__?: { dehydratedState: DehydratedState | null }
  }
}

const dehydratedState = window.__SSR_STATE__?.dehydratedState ?? null

const { queryClient, trpcClient } = getBrowserClients()

const router = createBrowserRouter(routes)

ReactDOM.hydrateRoot(
  document.getElementById('app') as HTMLElement,
  <App queryClient={queryClient} trpcClient={trpcClient} dehydratedState={dehydratedState}>
    <RouterProvider router={router} />
  </App>
)
