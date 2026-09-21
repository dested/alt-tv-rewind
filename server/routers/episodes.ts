import { z } from 'zod'
import { TRPCError } from '@trpc/server'
import { router, publicProcedure } from '../trpc'
import { prisma } from '../prisma'
import {
  episodeCardSelect,
  toEpisodeCard,
  iso,
  isoOrNull,
  daysBetweenAirAndPost,
  type EpisodeCard,
} from './shared'

// Day resolution, not hours: most 1995–2000 posts carry no time of day.
const REACTION_DAY_FROM = -1
const REACTION_DAY_TO = 14

const reactionRowSchema = z.object({ day: z.number().int(), messages: z.number().int() })

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

      const [prev, next, kindGroups, sentimentGroups, quoteThreads, archive] = await Promise.all([
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
            slug: true,
            subject: true,
            pullQuote: true,
            pullQuoteMessageId: true,
            rootMessageId: true,
            startedAt: true,
            startedDateOnly: true,
          },
        }),
        prisma.archive.findFirst({
          where: { showId: ep.showId },
          select: { firstPostAt: true },
        }),
      ])

      // Posts per calendar day (network zone) after the air date, over this
      // episode's live primary threads. Date-only posts sit at 12:00Z, which is
      // the same ET date, so they bucket correctly. Every day in [-1, 14] is
      // emitted with zeros filled.
      const rawByDay = await prisma.$queryRaw`
        SELECT ((m.posted_at AT TIME ZONE 'UTC' AT TIME ZONE 'America/New_York')::date - e.air_date)::int AS day,
               count(*)::int AS messages
        FROM message m
        JOIN thread_episode te
          ON te.thread_id = m.thread_id
         AND te.episode_id = ${ep.id}
         AND te.is_primary
         AND te.relation = 'live'::"EpisodeRelation"
        JOIN episode e ON e.id = te.episode_id
        WHERE NOT m.is_spam
        GROUP BY day
      `
      const byDay = new Map(
        z
          .array(reactionRowSchema)
          .parse(rawByDay)
          .map((r) => [r.day, r.messages])
      )
      const reactionByDay: Array<{ day: number; messages: number }> = []
      for (let day = REACTION_DAY_FROM; day <= REACTION_DAY_TO; day++) {
        reactionByDay.push({ day, messages: byDay.get(day) ?? 0 })
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
            select: {
              id: true,
              postedAt: true,
              dateOnly: true,
              poster: { select: { displayName: true } },
            },
          })
        : []
      const messageById = new Map(quoteMessages.map((m) => [m.id, m]))

      const quotes = quoteThreads.flatMap((t) => {
        if (t.pullQuote === null) return []
        const targetId = t.pullQuoteMessageId ?? t.rootMessageId
        const msg = targetId === null ? undefined : messageById.get(targetId)
        const postedAt = msg ? msg.postedAt : t.startedAt
        const postedDateOnly = msg ? msg.dateOnly : t.startedDateOnly
        // Same timing contract as ThreadCard: hours only when the clock is real.
        const hoursAfterAir =
          ep.airStamp === null || postedDateOnly
            ? null
            : Math.round(((postedAt.getTime() - ep.airStamp.getTime()) / 3_600_000) * 10) / 10
        return [
          {
            threadId: t.id,
            threadSlug: t.slug,
            subject: t.subject,
            pullQuote: t.pullQuote,
            posterName: msg?.poster.displayName ?? null,
            postedAt: iso(postedAt),
            postedDateOnly,
            hoursAfterAir,
            daysAfterAir: daysBetweenAirAndPost(ep.airDate, postedAt),
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
        // First captured post — episodes that aired before it can have no live reaction.
        archiveFrom: isoOrNull(archive?.firstPostAt ?? null),
        prev,
        next,
        reactionByDay,
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
