import { z } from 'zod'
import { TRPCError } from '@trpc/server'
import { Prisma } from '@prisma/client'
import { router, publicProcedure } from '../trpc'
import { prisma } from '../prisma'
import {
  threadCardSelect,
  mapThreadCards,
  relationInput,
  iso,
  sourceLocationSourceSelect,
  sourceLocationFor,
  postTimingFor,
  type ThreadCard,
  type SourceRef,
  type SourceLocation,
  type PostTiming,
} from './shared'

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
        source: z.string().optional(),
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
      if (input.source !== undefined) {
        where.archive = { source: { key: input.source } }
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

  // Addressed by show + thread slug; the numeric id is not stable across reloads.
  get: publicProcedure
    .input(z.object({ show: z.string().min(1), slug: z.string().min(1) }))
    .query(async ({ input }) => {
      const base = await prisma.thread.findFirst({
        where: { slug: input.slug, show: { slug: input.show } },
        select: threadCardSelect,
      })
      if (!base) throw new TRPCError({ code: 'NOT_FOUND' })
      const [card] = await mapThreadCards([base])
      if (!card) throw new TRPCError({ code: 'NOT_FOUND' })

      const [detail, messages] = await Promise.all([
        prisma.thread.findUnique({
          where: { id: base.id },
          select: {
            show: { select: { slug: true, name: true, liveWindowDays: true } },
            archive: {
              select: { newsgroup: true, source: { select: sourceLocationSourceSelect } },
            },
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
          where: { threadId: base.id },
          orderBy: [{ postedAt: 'asc' }, { id: 'asc' }],
          take: 1000,
          select: {
            id: true,
            parentId: true,
            depth: true,
            subject: true,
            postedAt: true,
            dateOnly: true,
            datePrecision: true,
            body: true,
            lineCount: true,
            isSpam: true,
            poster: { select: { id: true, displayName: true } },
            sourceRecord: {
              select: {
                recordId: true,
                externalId: true,
                originalUrl: true,
                source: { select: sourceLocationSourceSelect },
                observations: { select: { capturedAt: true, capturedPageUrl: true } },
              },
            },
            _count: { select: { sources: true } },
          },
        }),
      ])
      if (!detail) throw new TRPCError({ code: 'NOT_FOUND' })

      // Fallback community for a message whose archive was never backfilled with a
      // source (should not happen with the nine legacy rows, but keeps types total).
      const synthSource = {
        key: 'unknown',
        name: detail.archive.newsgroup,
        kind: 'usenet',
        publication: 'public',
        homeUrl: null,
        collectionUrl: null,
        originalStatus: 'unknown',
      } as const
      const archiveSource = detail.archive.source
      const primaryEp = detail.episodes.find((e) => e.isPrimary) ?? null
      const liveWindowDays = detail.show.liveWindowDays

      const projected = messages.map((m) => {
        const rec = m.sourceRecord
        const locSource = rec?.source ?? archiveSource ?? synthSource
        const location: SourceLocation = sourceLocationFor(
          locSource,
          rec
            ? { recordId: rec.recordId, externalId: rec.externalId, originalUrl: rec.originalUrl }
            : null,
          rec?.observations ?? []
        )
        const timing: PostTiming | null = primaryEp
          ? postTimingFor(primaryEp.episode.airDate, m.postedAt, liveWindowDays, m.datePrecision)
          : null
        return {
          id: m.id,
          parentId: m.parentId,
          depth: m.depth,
          subject: m.subject,
          postedAt: iso(m.postedAt),
          dateOnly: m.dateOnly,
          datePrecision: m.datePrecision,
          body: m.body,
          lineCount: m.lineCount,
          isSpam: m.isSpam,
          poster: { id: m.poster.id, displayName: m.poster.displayName },
          source: location.source,
          location,
          additionalSourceCount: Math.max(0, m._count.sources - 1),
          timing,
        }
      })

      // Distinct communities across the thread, the thread's own source first.
      const sourceByKey = new Map<string, SourceRef>()
      if (card.source) sourceByKey.set(card.source.key, card.source)
      for (const p of projected) {
        if (!sourceByKey.has(p.source.key)) sourceByKey.set(p.source.key, p.source)
      }

      const thread: ThreadCard & {
        showSlug: string
        showName: string
        sources: SourceRef[]
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
        sources: [...sourceByKey.values()],
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
        messages: projected,
        truncated: base.messageCount > 1000,
      }
    }),

  latest: publicProcedure
    .input(
      z.object({ slug: z.string().min(1), limit: z.number().int().min(1).max(50).default(20) })
    )
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
