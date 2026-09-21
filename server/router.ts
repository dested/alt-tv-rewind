import { router, protectedProcedure } from './trpc'
import { showsRouter } from './routers/shows'
import { episodesRouter } from './routers/episodes'
import { threadsRouter } from './routers/threads'
import { searchRouter } from './routers/search'
import { postersRouter } from './routers/posters'
import { adminRouter } from './routers/admin'

export const appRouter = router({
  me: protectedProcedure.query(({ ctx }) => ctx.session.user),
  shows: showsRouter,
  episodes: episodesRouter,
  threads: threadsRouter,
  search: searchRouter,
  posters: postersRouter,
  admin: adminRouter,
})

export type AppRouter = typeof appRouter
