import { z } from 'zod'
import { TRPCError } from '@trpc/server'
import { router, publicProcedure } from '../trpc'
import { prisma } from '../prisma'
import { threadCardSelect, mapThreadCards, iso, isoOrNull, type ThreadCard } from './shared'

const showMessageRowSchema = z.object({
  slug: z.string(),
  name: z.string(),
  messageCount: z.number().int(),
})
const byYearRowSchema = z.object({ year: z.number().int(), messages: z.number().int() })
const startedIdRowSchema = z.object({ id: z.number().int() })
const topRowSchema = z.object({
  id: z.number().int(),
  displayName: z.string(),
  messageCount: z.number().int(),
  threadCount: z.number().int(),
  firstPostAt: z.date().nullable(),
  lastPostAt: z.date().nullable(),
})
const prophetRowSchema = z.object({
  id: z.number().int(),
  displayName: z.string(),
  predictionCount: z.number().int(),
  predictionHits: z.number().int(),
  hitRate: z.number(),
})

// Fetch ThreadCards for a set of thread ids, preserving the given order.
async function threadCardsByIds(ids: number[]): Promise<ThreadCard[]> {
  if (ids.length === 0) return []
  const rows = await prisma.thread.findMany({ where: { id: { in: ids } }, select: threadCardSelect })
  const byId = new Map(rows.map((r) => [r.id, r]))
  const ordered = ids.flatMap((id) => {
    const row = byId.get(id)
    return row ? [row] : []
  })
  return mapThreadCards(ordered)
}

export const postersRouter = router({
  get: publicProcedure.input(z.object({ id: z.number().int() })).query(async ({ input }) => {
    const poster = await prisma.poster.findUnique({
      where: { id: input.id },
      select: {
        id: true,
        displayName: true,
        messageCount: true,
        threadCount: true,
        predictionCount: true,
        predictionHits: true,
        firstPostAt: true,
        lastPostAt: true,
      },
    })
    if (!poster) throw new TRPCError({ code: 'NOT_FOUND' })

    const [showsRaw, byYearRaw, startedIdsRaw, predIdsRaw] = await Promise.all([
      prisma.$queryRaw`
        SELECT s.slug, s.name, count(*)::int AS "messageCount"
        FROM message m
        JOIN archive a ON a.id = m.archive_id
        JOIN show s ON s.id = a.show_id
        WHERE m.poster_id = ${input.id}
        GROUP BY s.id, s.slug, s.name
        ORDER BY count(*) DESC
      `,
      prisma.$queryRaw`
        SELECT extract(year FROM m.posted_at)::int AS year, count(*)::int AS messages
        FROM message m
        WHERE m.poster_id = ${input.id}
        GROUP BY year
        ORDER BY year ASC
      `,
      prisma.$queryRaw`
        SELECT t.id
        FROM thread t
        JOIN message m ON m.id = t.root_message_id
        WHERE m.poster_id = ${input.id} AND NOT t.is_spam
        ORDER BY t.message_count DESC
        LIMIT 20
      `,
      prisma.$queryRaw`
        SELECT t.id
        FROM thread t
        JOIN message m ON m.id = t.root_message_id
        WHERE m.poster_id = ${input.id} AND t.prediction_claim IS NOT NULL
        ORDER BY t.started_at DESC
      `,
    ])

    const shows = z.array(showMessageRowSchema).parse(showsRaw)
    const byYear = z.array(byYearRowSchema).parse(byYearRaw)
    const startedIds = z.array(startedIdRowSchema).parse(startedIdsRaw).map((r) => r.id)
    const predIds = z.array(startedIdRowSchema).parse(predIdsRaw).map((r) => r.id)

    const threadsStarted = await threadCardsByIds(startedIds)

    const predRows = predIds.length
      ? await prisma.thread.findMany({
          where: { id: { in: predIds } },
          select: {
            id: true,
            slug: true,
            subject: true,
            predictionClaim: true,
            predictionOutcome: true,
            startedAt: true,
            episodes: {
              where: { isPrimary: true },
              select: { episode: { select: { slug: true, title: true } } },
            },
          },
        })
      : []
    const predById = new Map(predRows.map((p) => [p.id, p]))
    const predictions = predIds.flatMap((id) => {
      const p = predById.get(id)
      if (!p || p.predictionClaim === null) return []
      const primary = p.episodes[0] ?? null
      return [
        {
          threadId: p.id,
          threadSlug: p.slug,
          subject: p.subject,
          predictionClaim: p.predictionClaim,
          predictionOutcome: p.predictionOutcome,
          startedAt: iso(p.startedAt),
          episode: primary ? { slug: primary.episode.slug, title: primary.episode.title } : null,
        },
      ]
    })

    return {
      poster: {
        id: poster.id,
        displayName: poster.displayName,
        messageCount: poster.messageCount,
        threadCount: poster.threadCount,
        predictionCount: poster.predictionCount,
        predictionHits: poster.predictionHits,
        firstPostAt: isoOrNull(poster.firstPostAt),
        lastPostAt: isoOrNull(poster.lastPostAt),
      },
      shows,
      byYear,
      threadsStarted,
      predictions,
    }
  }),

  top: publicProcedure
    .input(
      z.object({ slug: z.string().min(1), limit: z.number().int().min(1).max(100).default(50) })
    )
    .query(async ({ input }) => {
      const show = await prisma.show.findUnique({
        where: { slug: input.slug },
        select: { id: true },
      })
      if (!show) throw new TRPCError({ code: 'NOT_FOUND' })
      const raw = await prisma.$queryRaw`
        SELECT p.id, p.display_name AS "displayName",
               count(m.id)::int AS "messageCount",
               count(t.id) FILTER (WHERE NOT t.is_spam)::int AS "threadCount",
               min(m.posted_at) AS "firstPostAt",
               max(m.posted_at) AS "lastPostAt"
        FROM message m
        JOIN archive a ON a.id = m.archive_id
        JOIN poster p ON p.id = m.poster_id
        LEFT JOIN thread t ON t.root_message_id = m.id
        WHERE a.show_id = ${show.id}
        GROUP BY p.id, p.display_name
        ORDER BY count(m.id) DESC
        LIMIT ${input.limit}
      `
      const rows = z.array(topRowSchema).parse(raw)
      return rows.map((r) => ({
        id: r.id,
        displayName: r.displayName,
        messageCount: r.messageCount,
        threadCount: r.threadCount,
        firstPostAt: isoOrNull(r.firstPostAt),
        lastPostAt: isoOrNull(r.lastPostAt),
      }))
    }),

  prophets: publicProcedure
    .input(z.object({ slug: z.string().min(1), limit: z.number().int().min(1).max(100).default(20) }))
    .query(async ({ input }) => {
      const show = await prisma.show.findUnique({
        where: { slug: input.slug },
        select: { id: true },
      })
      if (!show) throw new TRPCError({ code: 'NOT_FOUND' })
      const raw = await prisma.$queryRaw`
        SELECT p.id, p.display_name AS "displayName",
               p.prediction_count AS "predictionCount",
               p.prediction_hits AS "predictionHits",
               (p.prediction_hits::float / p.prediction_count) AS "hitRate"
        FROM poster p
        WHERE p.prediction_count >= 3
          AND EXISTS (
            SELECT 1 FROM thread t
            JOIN message m ON m.id = t.root_message_id
            WHERE m.poster_id = p.id AND t.show_id = ${show.id} AND t.kind = 'prediction'::"ThreadKind"
          )
        ORDER BY "hitRate" DESC, p.prediction_count DESC
        LIMIT ${input.limit}
      `
      return z.array(prophetRowSchema).parse(raw)
    }),
})
