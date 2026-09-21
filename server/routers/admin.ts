import { z } from 'zod'
import { TRPCError } from '@trpc/server'
import { ThreadKind, Sentiment, type EpisodeRelation, type Prisma } from '@prisma/client'
import { router, protectedProcedure } from '../trpc'
import { prisma } from '../prisma'

const DAY_MS = 24 * 60 * 60 * 1000

export const adminRouter = router({
  // Reassign a thread's primary episode. Counter columns are recomputed by the
  // pipeline's stats stage, not here.
  setThreadEpisode: protectedProcedure
    .input(z.object({ threadId: z.number().int(), episodeId: z.number().int().nullable() }))
    .mutation(async ({ input }) => {
      const thread = await prisma.thread.findUnique({
        where: { id: input.threadId },
        select: { startedAt: true },
      })
      if (!thread) throw new TRPCError({ code: 'NOT_FOUND' })

      await prisma.threadEpisode.deleteMany({
        where: { threadId: input.threadId, isPrimary: true },
      })

      if (input.episodeId !== null) {
        const episode = await prisma.episode.findUnique({
          where: { id: input.episodeId },
          select: { airDate: true, show: { select: { liveWindowDays: true } } },
        })
        if (!episode) throw new TRPCError({ code: 'NOT_FOUND' })

        const air = episode.airDate.getTime()
        const started = thread.startedAt.getTime()
        const relation: EpisodeRelation =
          started >= air - DAY_MS && started <= air + episode.show.liveWindowDays * DAY_MS
            ? 'live'
            : 'retro'

        await prisma.threadEpisode.upsert({
          where: {
            threadId_episodeId: { threadId: input.threadId, episodeId: input.episodeId },
          },
          create: {
            threadId: input.threadId,
            episodeId: input.episodeId,
            relation,
            confidence: 100,
            method: 'manual',
            isPrimary: true,
          },
          update: { relation, confidence: 100, method: 'manual', isPrimary: true },
        })
      }

      return { ok: true } as const
    }),

  setThreadSpam: protectedProcedure
    .input(z.object({ threadId: z.number().int(), isSpam: z.boolean() }))
    .mutation(async ({ input }) => {
      const updated = await prisma.thread.updateMany({
        where: { id: input.threadId },
        data: { isSpam: input.isSpam },
      })
      if (updated.count === 0) throw new TRPCError({ code: 'NOT_FOUND' })
      return { ok: true } as const
    }),

  setThreadClassification: protectedProcedure
    .input(
      z.object({
        threadId: z.number().int(),
        kind: z.nativeEnum(ThreadKind).optional(),
        sentiment: z.nativeEnum(Sentiment).optional(),
        hotTake: z.boolean().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const data: Prisma.ThreadUpdateManyMutationInput = {}
      if (input.kind !== undefined) data.kind = input.kind
      if (input.sentiment !== undefined) data.sentiment = input.sentiment
      if (input.hotTake !== undefined) data.hotTake = input.hotTake
      const updated = await prisma.thread.updateMany({ where: { id: input.threadId }, data })
      if (updated.count === 0) throw new TRPCError({ code: 'NOT_FOUND' })
      return { ok: true } as const
    }),
})
