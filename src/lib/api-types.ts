import type { inferRouterInputs, inferRouterOutputs } from '@trpc/server'
import type { AppRouter } from '../../server/router'

// Type-only bridge to the server router (erased at build time — see CLAUDE.md
// hard rule #2). Components type their props off these instead of redeclaring
// wire shapes.
export type RouterOutputs = inferRouterOutputs<AppRouter>
export type RouterInputs = inferRouterInputs<AppRouter>

export type ThreadCard = RouterOutputs['threads']['byEpisode']['items'][number]
export type EpisodeCard = RouterOutputs['episodes']['list'][number]
export type SourceLocationData = RouterOutputs['threads']['get']['messages'][number]['location']
