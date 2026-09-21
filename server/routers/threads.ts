import { z } from 'zod'
import { TRPCError } from '@trpc/server'
import { Prisma } from '@prisma/client'
import { router, publicProcedure } from '../trpc'
import { prisma } from '../prisma'
import { threadCardSelect, mapThreadCards, relationInput, iso, type ThreadCard } from './shared'

const filterInput = z
  .enum(['all', 'controversial', 'loved', 'hated', 'predictions', 'theories', 'questions'])
  .default('all')
const sortInput = z.enum(['size', 'date', 'controversy']).default('size')

export const threadsRouter = router({
  byEpisode: publicProcedure
    .input(
      z.object({
        episodeId: z.number().int(),
        relation: relationInput,
        filter: filterInput,
        sort: sortInput,
        cursor: z.number().int().min(0).default(0),
        limit: z.number().int().min(1).max(50).default(20),
      })
    )
    .query(async ({ input }) => {
      const where: Prisma.ThreadWhereInput = {
        isSpam: false,
        episodes: {
          some: { episodeId: input.episodeId, isPrimary: true, relation: input.relation },
        },
      }
      switch (input.filter) {
        case 'controversial':
          where.controversy = { gt: 0 }
          break
        case 'loved':
          where.sentiment = { in: ['loved', 'liked'] }
          break
        case 'hated':
          where.sentiment = { in: ['hated', 'disliked'] }
          break
        case 'predictions':
          where.kind = 'prediction'
          break
        case 'theories':
          where.kind = 'theory'
          break
        case 'questions':
          where.kind = 'question'
          break
        case 'all':
          break
      }

      // A 'controversial' filter with the default 'size' sort implies controversy order.
      const effectiveSort =
        input.filter === 'controversial' && input.sort === 'size' ? 'controversy' : input.sort
      const orderBy: Prisma.ThreadOrderByWithRelationInput[] =
        effectiveSort === 'size'
          ? [{ messageCount: 'desc' }]
          : effectiveSort === 'date'
            ? [{ startedAt: 'asc' }]
            : [{ controversy: 'desc' }, { messageCount: 'desc' }]

      const [rows, total] = await Promise.all([
        prisma.thread.findMany({
          where,
          orderBy,
          skip: input.cursor,
          take: input.limit,
          select: threadCardSelect,
        }),
        prisma.thread.count({ where }),
      ])
      const items = await mapThreadCards(rows)
      const consumed = input.cursor + rows.length
      return { items, nextCursor: consumed < total ? consumed : null, total }
    }),

  get: publicProcedure.input(z.object({ id: z.number().int() })).query(async ({ input }) => {
    const base = await prisma.thread.findUnique({
      where: { id: input.id },
      select: threadCardSelect,
    })
    if (!base) throw new TRPCError({ code: 'NOT_FOUND' })
    const [card] = await mapThreadCards([base])
    if (!card) throw new TRPCError({ code: 'NOT_FOUND' })

    const [detail, messages] = await Promise.all([
      prisma.thread.findUnique({
        where: { id: input.id },
        select: {
          show: { select: { slug: true, name: true } },
          episodes: {
            orderBy: [{ isPrimary: 'desc' }, { confidence: 'desc' }],
            select: {
              relation: true,
              confidence: true,
              method: true,
              isPrimary: true,
              episode: {
                select: {
                  slug: true,
                  title: true,
                  seasonNumber: true,
                  number: true,
                  airDate: true,
                },
              },
            },
          },
        },
      }),
      prisma.message.findMany({
        where: { threadId: input.id },
        orderBy: [{ postedAt: 'asc' }, { id: 'asc' }],
        take: 1000,
        select: {
          id: true,
          parentId: true,
          depth: true,
          subject: true,
          postedAt: true,
          body: true,
          lineCount: true,
          isSpam: true,
          poster: { select: { id: true, displayName: true } },
        },
      }),
    ])
    if (!detail) throw new TRPCError({ code: 'NOT_FOUND' })

    const thread: ThreadCard & {
      showSlug: string
      showName: string
      episodes: Array<{
        slug: string
        title: string
        seasonNumber: number
        number: number
        airDate: string
        relation: 'live' | 'retro'
        confidence: number
        method: string
        isPrimary: boolean
      }>
    } = {
      ...card,
      showSlug: detail.show.slug,
      showName: detail.show.name,
      episodes: detail.episodes.map((te) => ({
        slug: te.episode.slug,
        title: te.episode.title,
        seasonNumber: te.episode.seasonNumber,
        number: te.episode.number,
        airDate: te.episode.airDate.toISOString().slice(0, 10),
        relation: te.relation,
        confidence: te.confidence,
        method: te.method,
        isPrimary: te.isPrimary,
      })),
    }

    return {
      thread,
      messages: messages.map((m) => ({
        id: m.id,
        parentId: m.parentId,
        depth: m.depth,
        subject: m.subject,
        postedAt: iso(m.postedAt),
        body: m.body,
        lineCount: m.lineCount,
        isSpam: m.isSpam,
        poster: { id: m.poster.id, displayName: m.poster.displayName },
      })),
      truncated: base.messageCount > 1000,
    }
  }),

  latest: publicProcedure
    .input(z.object({ slug: z.string().min(1), limit: z.number().int().min(1).max(50).default(20) }))
    .query(async ({ input }) => {
      const show = await prisma.show.findUnique({
        where: { slug: input.slug },
        select: { id: true },
      })
      if (!show) throw new TRPCError({ code: 'NOT_FOUND' })
      const rows = await prisma.thread.findMany({
        where: { showId: show.id, isSpam: false },
        orderBy: { startedAt: 'desc' },
        take: input.limit,
        select: threadCardSelect,
      })
      return mapThreadCards(rows)
    }),
})
