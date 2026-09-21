import { z } from 'zod'
import { TRPCError } from '@trpc/server'
import { router, publicProcedure } from '../trpc'
import { prisma } from '../prisma'
import {
  slugInput,
  archiveSelect,
  toArchiveSummary,
  episodeCardSelect,
  toEpisodeCard,
  isoDate,
  isoDateOrNull,
  isoOrNull,
  isoMonth,
} from './shared'

// Resolves a show slug to its id, throwing NOT_FOUND when unknown. Every
// show-scoped procedure funnels through this so a bogus slug never returns a
// misleading empty payload.
async function showIdBySlug(slug: string): Promise<number> {
  const show = await prisma.show.findUnique({ where: { slug }, select: { id: true } })
  if (!show) throw new TRPCError({ code: 'NOT_FOUND' })
  return show.id
}

export const showsRouter = router({
  list: publicProcedure.query(async () => {
    const shows = await prisma.show.findMany({
      orderBy: { name: 'asc' },
      select: {
        slug: true,
        name: true,
        imageUrl: true,
        premiered: true,
        ended: true,
        network: true,
        _count: { select: { seasons: true, episodes: true } },
        archives: { orderBy: { id: 'asc' }, take: 1, select: archiveSelect },
      },
    })
    return shows.map((s) => ({
      slug: s.slug,
      name: s.name,
      imageUrl: s.imageUrl,
      premiered: isoDateOrNull(s.premiered),
      ended: isoDateOrNull(s.ended),
      network: s.network,
      seasonCount: s._count.seasons,
      episodeCount: s._count.episodes,
      archive: s.archives[0] ? toArchiveSummary(s.archives[0]) : null,
    }))
  }),

  get: publicProcedure.input(slugInput).query(async ({ input }) => {
    const show = await prisma.show.findUnique({
      where: { slug: input.slug },
      select: {
        id: true,
        slug: true,
        name: true,
        imageUrl: true,
        premiered: true,
        ended: true,
        network: true,
        summary: true,
        liveWindowDays: true,
        archives: { orderBy: { id: 'asc' }, take: 1, select: archiveSelect },
        seasons: {
          orderBy: { number: 'asc' },
          select: {
            number: true,
            premiered: true,
            ended: true,
            episodeCount: true,
            liveMessageCount: true,
            retroMessageCount: true,
          },
        },
      },
    })
    if (!show) throw new TRPCError({ code: 'NOT_FOUND' })

    const [topEpisodes, mostLoved, mostHated] = await Promise.all([
      prisma.episode.findMany({
        where: { showId: show.id },
        orderBy: [{ liveMessageCount: 'desc' }, { airDate: 'asc' }],
        take: 8,
        select: episodeCardSelect,
      }),
      prisma.episode.findMany({
        where: { showId: show.id, usenetScore: { not: null } },
        orderBy: { usenetScore: 'desc' },
        take: 5,
        select: episodeCardSelect,
      }),
      prisma.episode.findMany({
        where: { showId: show.id, usenetScore: { not: null } },
        orderBy: { usenetScore: 'asc' },
        take: 5,
        select: episodeCardSelect,
      }),
    ])

    return {
      show: {
        id: show.id,
        slug: show.slug,
        name: show.name,
        imageUrl: show.imageUrl,
        premiered: isoDateOrNull(show.premiered),
        ended: isoDateOrNull(show.ended),
        network: show.network,
        summary: show.summary,
        liveWindowDays: show.liveWindowDays,
      },
      archive: show.archives[0] ? toArchiveSummary(show.archives[0]) : null,
      seasons: show.seasons.map((s) => ({
        number: s.number,
        premiered: isoDateOrNull(s.premiered),
        ended: isoDateOrNull(s.ended),
        episodeCount: s.episodeCount,
        liveMessageCount: s.liveMessageCount,
        retroMessageCount: s.retroMessageCount,
      })),
      topEpisodes: topEpisodes.map(toEpisodeCard),
      mostLoved: mostLoved.map(toEpisodeCard),
      mostHated: mostHated.map(toEpisodeCard),
    }
  }),

  timeline: publicProcedure.input(slugInput).query(async ({ input }) => {
    const showId = await showIdBySlug(input.slug)
    const [days, episodes, seasons] = await Promise.all([
      prisma.dailyVolume.findMany({
        where: { showId },
        orderBy: { day: 'asc' },
        select: { day: true, messageCount: true, threadCount: true },
      }),
      prisma.episode.findMany({
        where: { showId },
        orderBy: [{ seasonNumber: 'asc' }, { number: 'asc' }],
        select: {
          slug: true,
          title: true,
          seasonNumber: true,
          number: true,
          airDate: true,
          liveMessageCount: true,
        },
      }),
      prisma.season.findMany({
        where: { showId },
        orderBy: { number: 'asc' },
        select: { number: true, premiered: true, ended: true },
      }),
    ])
    return {
      days: days.map((d) => ({
        day: isoDate(d.day),
        messages: d.messageCount,
        threads: d.threadCount,
      })),
      episodes: episodes.map((e) => ({
        slug: e.slug,
        title: e.title,
        seasonNumber: e.seasonNumber,
        number: e.number,
        airDate: isoDate(e.airDate),
        liveMessageCount: e.liveMessageCount,
      })),
      seasons: seasons.map((s) => ({
        number: s.number,
        premiered: isoDateOrNull(s.premiered),
        ended: isoDateOrNull(s.ended),
      })),
    }
  }),

  thenVsNow: publicProcedure.input(slugInput).query(async ({ input }) => {
    const showId = await showIdBySlug(input.slug)
    const eps = await prisma.episode.findMany({
      where: { showId, usenetScore: { not: null }, tvmazeRating: { not: null } },
      orderBy: [{ seasonNumber: 'asc' }, { number: 'asc' }],
      select: {
        slug: true,
        title: true,
        seasonNumber: true,
        number: true,
        airDate: true,
        usenetScore: true,
        tvmazeRating: true,
        liveThreadCount: true,
      },
    })
    return eps.flatMap((e) =>
      e.usenetScore === null || e.tvmazeRating === null
        ? []
        : [
            {
              slug: e.slug,
              title: e.title,
              seasonNumber: e.seasonNumber,
              number: e.number,
              airDate: isoDate(e.airDate),
              usenetScore: e.usenetScore,
              tvmazeRating: e.tvmazeRating,
              liveThreadCount: e.liveThreadCount,
            },
          ]
    )
  }),

  phrases: publicProcedure.input(slugInput).query(async ({ input }) => {
    const showId = await showIdBySlug(input.slug)
    const phrases = await prisma.phrase.findMany({
      where: { showId },
      orderBy: { firstAt: { sort: 'asc', nulls: 'last' } },
      select: {
        slug: true,
        label: true,
        episodeSlug: true,
        firstAt: true,
        firstMessageId: true,
        totalCount: true,
        monthly: { orderBy: { month: 'asc' }, select: { month: true, count: true } },
      },
    })

    // firstThreadId is the thread of the phrase's first message — resolved in one batch.
    const firstMessageIds = phrases.flatMap((p) =>
      p.firstMessageId === null ? [] : [p.firstMessageId]
    )
    const firstMessages = firstMessageIds.length
      ? await prisma.message.findMany({
          where: { id: { in: firstMessageIds } },
          select: { id: true, threadId: true },
        })
      : []
    const threadByMessageId = new Map(firstMessages.map((m) => [m.id, m.threadId]))

    return phrases.map((p) => ({
      slug: p.slug,
      label: p.label,
      episodeSlug: p.episodeSlug,
      firstAt: isoOrNull(p.firstAt),
      firstMessageId: p.firstMessageId,
      firstThreadId:
        p.firstMessageId === null ? null : threadByMessageId.get(p.firstMessageId) ?? null,
      totalCount: p.totalCount,
      monthly: p.monthly.map((m) => ({ month: isoMonth(m.month), count: m.count })),
    }))
  }),
})
