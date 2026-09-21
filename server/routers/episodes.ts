import { z } from 'zod'
import { TRPCError } from '@trpc/server'
import { router, publicProcedure } from '../trpc'
import { prisma } from '../prisma'
import { episodeCardSelect, toEpisodeCard, iso, isoOrNull, type EpisodeCard } from './shared'

const REACTION_CURVE_FROM = -6
const REACTION_CURVE_TO = 96

const reactionRowSchema = z.object({ hour: z.number().int(), messages: z.number().int() })

export const episodesRouter = router({
  list: publicProcedure
    .input(z.object({ slug: z.string().min(1), season: z.number().int().optional() }))
    .query(async ({ input }) => {
      const show = await prisma.show.findUnique({
        where: { slug: input.slug },
        select: { id: true },
      })
      if (!show) throw new TRPCError({ code: 'NOT_FOUND' })
      const eps = await prisma.episode.findMany({
        where: {
          showId: show.id,
          ...(input.season === undefined ? {} : { seasonNumber: input.season }),
        },
        orderBy: [{ seasonNumber: 'asc' }, { number: 'asc' }],
        select: episodeCardSelect,
      })
      return eps.map(toEpisodeCard)
    }),

  get: publicProcedure
    .input(z.object({ slug: z.string().min(1), episode: z.string().min(1) }))
    .query(async ({ input }) => {
      const ep = await prisma.episode.findFirst({
        where: { show: { slug: input.slug }, slug: input.episode },
        select: {
          ...episodeCardSelect,
          showId: true,
          summary: true,
          airStamp: true,
          runtime: true,
          recap: true,
          livePosterCount: true,
          show: { select: { slug: true, name: true, liveWindowDays: true } },
        },
      })
      if (!ep) throw new TRPCError({ code: 'NOT_FOUND' })

      const [prev, next, kindGroups, sentimentGroups, quoteThreads] = await Promise.all([
        prisma.episode.findFirst({
          where: {
            showId: ep.showId,
            OR: [
              { seasonNumber: { lt: ep.seasonNumber } },
              { seasonNumber: ep.seasonNumber, number: { lt: ep.number } },
            ],
          },
          orderBy: [{ seasonNumber: 'desc' }, { number: 'desc' }],
          select: { slug: true, title: true, seasonNumber: true, number: true },
        }),
        prisma.episode.findFirst({
          where: {
            showId: ep.showId,
            OR: [
              { seasonNumber: { gt: ep.seasonNumber } },
              { seasonNumber: ep.seasonNumber, number: { gt: ep.number } },
            ],
          },
          orderBy: [{ seasonNumber: 'asc' }, { number: 'asc' }],
          select: { slug: true, title: true, seasonNumber: true, number: true },
        }),
        prisma.thread.groupBy({
          by: ['kind'],
          where: {
            isSpam: false,
            kind: { not: null },
            episodes: { some: { episodeId: ep.id, isPrimary: true, relation: 'live' } },
          },
          _count: { _all: true },
        }),
        prisma.thread.groupBy({
          by: ['sentiment'],
          where: {
            isSpam: false,
            sentiment: { not: null },
            episodes: { some: { episodeId: ep.id, isPrimary: true, relation: 'live' } },
          },
          _count: { _all: true },
        }),
        prisma.thread.findMany({
          where: {
            isSpam: false,
            pullQuote: { not: null },
            episodes: { some: { episodeId: ep.id, isPrimary: true, relation: 'live' } },
          },
          orderBy: { messageCount: 'desc' },
          take: 6,
          select: {
            id: true,
            subject: true,
            pullQuote: true,
            pullQuoteMessageId: true,
            rootMessageId: true,
            startedAt: true,
          },
        }),
      ])

      // Hourly reaction curve over this episode's live primary threads. Only
      // meaningful with an airStamp; buckets outside the window are dropped and
      // every hour in [-6, 96] is emitted (zeros filled).
      let reactionCurve: Array<{ hour: number; messages: number }> = []
      if (ep.airStamp !== null) {
        const raw = await prisma.$queryRaw`
          SELECT floor(extract(epoch FROM (m.posted_at - e.air_stamp)) / 3600)::int AS hour,
                 count(*)::int AS messages
          FROM message m
          JOIN thread_episode te
            ON te.thread_id = m.thread_id
           AND te.episode_id = ${ep.id}
           AND te.is_primary
           AND te.relation = 'live'::"EpisodeRelation"
          JOIN episode e ON e.id = te.episode_id
          WHERE NOT m.is_spam AND e.air_stamp IS NOT NULL
          GROUP BY hour
        `
        const parsed = z.array(reactionRowSchema).parse(raw)
        const byHour = new Map(parsed.map((r) => [r.hour, r.messages]))
        reactionCurve = []
        for (let hour = REACTION_CURVE_FROM; hour <= REACTION_CURVE_TO; hour++) {
          reactionCurve.push({ hour, messages: byHour.get(hour) ?? 0 })
        }
      }

      // Resolve each quote's attributed message (pull_quote_message_id, else the
      // thread's root) for its poster name + timestamp, in one batched lookup.
      const quoteMessageIds = quoteThreads.flatMap((t) => {
        const targetId = t.pullQuoteMessageId ?? t.rootMessageId
        return targetId === null ? [] : [targetId]
      })
      const quoteMessages = quoteMessageIds.length
        ? await prisma.message.findMany({
            where: { id: { in: quoteMessageIds } },
            select: { id: true, postedAt: true, poster: { select: { displayName: true } } },
          })
        : []
      const messageById = new Map(quoteMessages.map((m) => [m.id, m]))

      const quotes = quoteThreads.flatMap((t) => {
        if (t.pullQuote === null) return []
        const targetId = t.pullQuoteMessageId ?? t.rootMessageId
        const msg = targetId === null ? undefined : messageById.get(targetId)
        return [
          {
            threadId: t.id,
            subject: t.subject,
            pullQuote: t.pullQuote,
            posterName: msg?.poster.displayName ?? null,
            postedAt: msg ? iso(msg.postedAt) : iso(t.startedAt),
          },
        ]
      })

      const episodeCard: EpisodeCard = toEpisodeCard(ep)

      return {
        episode: {
          ...episodeCard,
          summary: ep.summary,
          airStamp: isoOrNull(ep.airStamp),
          runtime: ep.runtime,
          recap: ep.recap,
          livePosterCount: ep.livePosterCount,
        },
        show: {
          slug: ep.show.slug,
          name: ep.show.name,
          liveWindowDays: ep.show.liveWindowDays,
        },
        prev,
        next,
        reactionCurve,
        breakdown: {
          kinds: kindGroups
            .flatMap((g) => (g.kind === null ? [] : [{ kind: g.kind, count: g._count._all }]))
            .sort((a, b) => b.count - a.count),
          sentiments: sentimentGroups
            .flatMap((g) =>
              g.sentiment === null ? [] : [{ sentiment: g.sentiment, count: g._count._all }]
            )
            .sort((a, b) => b.count - a.count),
        },
        quotes,
      }
    }),
})
