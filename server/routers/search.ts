import { z } from 'zod'
import { TRPCError } from '@trpc/server'
import { Prisma } from '@prisma/client'
import { router, publicProcedure } from '../trpc'
import { prisma } from '../prisma'
import { iso, sourceRefSelect } from './shared'

// ts_headline marks hits with the control chars U+0001 / U+0002 so the client
// can HTML-escape the fragment first, then swap the markers for <mark>. The
// snippet source strips quoted lines, mirroring the index trigger.
const HEADLINE_OPTIONS = 'MaxFragments=2, MaxWords=18, MinWords=8, StartSel=, StopSel='
// Mirrors the FTS trigger's quoted-line strip. String.raw: inside a template
// literal `\|` collapses to `|`, which made the alternation match every line
// and blanked every snippet.
const QUOTED_LINE_RE = String.raw`(^|\n)[ \t]*(>|\|)[^\n]*`
const RESULTS_LIMIT = 300
const HITS_PER_THREAD = 3
const THREADS_PER_PAGE = 20

const searchRowSchema = z.object({
  id: z.number().int(),
  threadId: z.number().int(),
  postedAt: z.date(),
  posterName: z.string(),
  sourceName: z.string(),
  sourceKey: z.string().nullable(),
  snippet: z.string(),
  rank: z.number(),
})

type Hit = {
  messageId: number
  posterName: string
  postedAt: string
  sourceName: string
  sourceKey: string | null
  snippet: string
}

export const searchRouter = router({
  query: publicProcedure
    .input(
      z.object({
        slug: z.string().min(1),
        q: z.string().min(1).max(200),
        season: z.number().int().optional(),
        episodeId: z.number().int().optional(),
        yearFrom: z.number().int().optional(),
        yearTo: z.number().int().optional(),
        posterId: z.number().int().optional(),
        source: z.string().optional(),
        cursor: z.number().int().min(0).default(0),
      })
    )
    .query(async ({ input }) => {
      const show = await prisma.show.findUnique({
        where: { slug: input.slug },
        select: { id: true },
      })
      if (!show) throw new TRPCError({ code: 'NOT_FOUND' })

      const empty = { threads: [], total: 0, nextCursor: null }
      if (input.q.trim() === '') return empty

      const conds: Prisma.Sql[] = [
        Prisma.sql`m.search @@ q`,
        Prisma.sql`t.show_id = ${show.id}`,
        Prisma.sql`NOT m.is_spam`,
        Prisma.sql`NOT t.is_spam`,
      ]
      if (input.season !== undefined) {
        conds.push(
          Prisma.sql`EXISTS (SELECT 1 FROM thread_episode te JOIN episode e ON e.id = te.episode_id WHERE te.thread_id = t.id AND te.is_primary AND e.season_number = ${input.season})`
        )
      }
      if (input.episodeId !== undefined) {
        conds.push(
          Prisma.sql`EXISTS (SELECT 1 FROM thread_episode te WHERE te.thread_id = t.id AND te.is_primary AND te.episode_id = ${input.episodeId})`
        )
      }
      if (input.yearFrom !== undefined) {
        conds.push(Prisma.sql`m.posted_at >= make_date(${input.yearFrom}, 1, 1)`)
      }
      if (input.yearTo !== undefined) {
        conds.push(Prisma.sql`m.posted_at < make_date(${input.yearTo} + 1, 1, 1)`)
      }
      if (input.posterId !== undefined) {
        conds.push(Prisma.sql`m.poster_id = ${input.posterId}`)
      }
      if (input.source !== undefined) {
        conds.push(Prisma.sql`a.source_id = (SELECT id FROM source WHERE key = ${input.source})`)
      }

      const raw = await prisma.$queryRaw`
        SELECT m.id, m.thread_id AS "threadId", m.posted_at AS "postedAt", p.display_name AS "posterName",
               COALESCE(s.name, a.newsgroup) AS "sourceName", s.key AS "sourceKey",
               ts_headline('english', regexp_replace(left(m.body, 6000), ${QUOTED_LINE_RE}, ' ', 'g'), q, ${HEADLINE_OPTIONS}) AS snippet,
               ts_rank_cd(m.search, q) AS rank
        FROM message m
        JOIN thread t ON t.id = m.thread_id
        JOIN poster p ON p.id = m.poster_id
        JOIN archive a ON a.id = m.archive_id
        LEFT JOIN source s ON s.id = a.source_id
        CROSS JOIN websearch_to_tsquery('english', ${input.q}) q
        WHERE ${Prisma.join(conds, ' AND ')}
        ORDER BY rank DESC, m.posted_at ASC
        LIMIT ${RESULTS_LIMIT}
      `
      const rows = z.array(searchRowSchema).parse(raw)

      // Group by thread, preserving first-appearance (rank) order, capped hits.
      const order: number[] = []
      const grouped = new Map<number, Hit[]>()
      for (const r of rows) {
        let hits = grouped.get(r.threadId)
        if (!hits) {
          hits = []
          grouped.set(r.threadId, hits)
          order.push(r.threadId)
        }
        if (hits.length < HITS_PER_THREAD) {
          hits.push({
            messageId: r.id,
            posterName: r.posterName,
            postedAt: iso(r.postedAt),
            sourceName: r.sourceName,
            sourceKey: r.sourceKey,
            snippet: r.snippet,
          })
        }
      }

      const total = order.length
      const pageIds = order.slice(input.cursor, input.cursor + THREADS_PER_PAGE)

      const threadRows = pageIds.length
        ? await prisma.thread.findMany({
            where: { id: { in: pageIds } },
            select: {
              id: true,
              slug: true,
              subject: true,
              startedAt: true,
              messageCount: true,
              archive: { select: { source: { select: sourceRefSelect } } },
              episodes: {
                where: { isPrimary: true },
                select: {
                  episode: {
                    select: { slug: true, title: true, seasonNumber: true, number: true },
                  },
                },
              },
            },
          })
        : []
      const threadById = new Map(threadRows.map((t) => [t.id, t]))

      const threads = pageIds.flatMap((tid) => {
        const t = threadById.get(tid)
        if (!t) return []
        const primary = t.episodes[0] ?? null
        const src = t.archive.source
        return [
          {
            thread: {
              id: t.id,
              slug: t.slug,
              subject: t.subject,
              startedAt: iso(t.startedAt),
              messageCount: t.messageCount,
              source: src ? { key: src.key, name: src.name, kind: src.kind } : null,
              episode: primary
                ? {
                    slug: primary.episode.slug,
                    title: primary.episode.title,
                    seasonNumber: primary.episode.seasonNumber,
                    number: primary.episode.number,
                  }
                : null,
            },
            hits: grouped.get(tid) ?? [],
          },
        ]
      })

      const consumed = input.cursor + pageIds.length
      return { threads, total, nextCursor: consumed < total ? consumed : null }
    }),
})
