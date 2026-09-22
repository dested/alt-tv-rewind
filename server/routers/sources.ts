import { z } from 'zod'
import { TRPCError } from '@trpc/server'
import { Prisma } from '@prisma/client'
import { router, publicProcedure } from '../trpc'
import { prisma } from '../prisma'
import {
  slugInput,
  sourceRefSelect,
  sourceLocationSourceSelect,
  sourceLocationFor,
  waybackStamp,
  isoOrNull,
  isoDateOrNull,
} from './shared'

// A compiled-document revision line, stored raw ("E, 22-Feb-97") in metadata;
// never rendered as a date. Null when absent or malformed.
function revisionOf(metadata: unknown): string | null {
  const parsed = z.object({ revision: z.object({ raw: z.string() }) }).safeParse(metadata)
  return parsed.success ? parsed.data.revision.raw : null
}

type EpisodeRef = { slug: string; title: string; seasonNumber: number; number: number } | null

function episodeSort(a: EpisodeRef, b: EpisodeRef): number {
  if (a && b) return a.seasonNumber - b.seasonNumber || a.number - b.number
  if (a) return -1
  if (b) return 1
  return 0
}

// Full source fields for a show's source listing (forShow).
const sourceListingSelect = {
  id: true,
  key: true,
  name: true,
  kind: true,
  legacy: true,
  publication: true,
  homeUrl: true,
  collectionUrl: true,
  custodian: true,
  notes: true,
  coverageFrom: true,
  coverageTo: true,
} satisfies Prisma.SourceSelect

type DispCounts = { accepted: number; context: number; excluded: number; needsReview: number }

export const sourcesRouter = router({
  // The global source catalog — every community we hold, legacy rows first.
  list: publicProcedure.query(async () => {
    const sources = await prisma.source.findMany({
      orderBy: [{ legacy: 'desc' }, { name: 'asc' }],
      select: {
        key: true,
        name: true,
        kind: true,
        legacy: true,
        publication: true,
        recordCount: true,
        observationCount: true,
        coverageFrom: true,
        coverageTo: true,
        homeUrl: true,
        collectionUrl: true,
        custodian: true,
        archives: {
          select: {
            messageCount: true,
            threadCount: true,
            show: { select: { slug: true, name: true } },
          },
        },
      },
    })
    return sources.map((s) => ({
      key: s.key,
      name: s.name,
      kind: s.kind,
      legacy: s.legacy,
      publication: s.publication,
      recordCount: s.recordCount,
      observationCount: s.observationCount,
      coverageFrom: isoDateOrNull(s.coverageFrom),
      coverageTo: isoDateOrNull(s.coverageTo),
      homeUrl: s.homeUrl,
      collectionUrl: s.collectionUrl,
      custodian: s.custodian,
      shows: s.archives
        .map((a) => ({
          slug: a.show.slug,
          name: a.show.name,
          messageCount: a.messageCount,
          threadCount: a.threadCount,
        }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    }))
  }),

  // One source: catalog fields, per-show dispositions, capture summary, and
  // (for capsules) the compiled documents catalogued from it.
  get: publicProcedure.input(z.object({ key: z.string().min(1) })).query(async ({ input }) => {
    const source = await prisma.source.findUnique({
      where: { key: input.key },
      select: {
        id: true,
        key: true,
        name: true,
        kind: true,
        legacy: true,
        publication: true,
        notes: true,
        originalStatus: true,
        recordCount: true,
        observationCount: true,
        coverageFrom: true,
        coverageTo: true,
        homeUrl: true,
        collectionUrl: true,
        custodian: true,
        archives: {
          select: {
            messageCount: true,
            threadCount: true,
            show: { select: { slug: true, name: true } },
          },
        },
        artifacts: { select: { format: true, capturedAt: true, verifiedAt: true } },
      },
    })
    if (!source) throw new TRPCError({ code: 'NOT_FOUND' })

    const dispRows = await prisma.recordShow.groupBy({
      by: ['showId', 'status'],
      where: { record: { sourceId: source.id } },
      _count: { _all: true },
    })
    const showIds = [...new Set(dispRows.map((d) => d.showId))]
    const showRows = showIds.length
      ? await prisma.show.findMany({
          where: { id: { in: showIds } },
          select: { id: true, slug: true, name: true },
        })
      : []
    const showById = new Map(showRows.map((s) => [s.id, s]))
    const dispByShow = new Map<number, DispCounts>()
    for (const d of dispRows) {
      let cur = dispByShow.get(d.showId)
      if (!cur) {
        cur = { accepted: 0, context: 0, excluded: 0, needsReview: 0 }
        dispByShow.set(d.showId, cur)
      }
      const n = d._count._all
      if (d.status === 'accepted') cur.accepted += n
      else if (d.status === 'context') cur.context += n
      else if (d.status === 'excluded') cur.excluded += n
      else if (d.status === 'needs_review') cur.needsReview += n
    }
    const dispositions = [...dispByShow.entries()]
      .flatMap(([showId, counts]) => {
        const show = showById.get(showId)
        return show ? [{ show: { slug: show.slug, name: show.name }, ...counts }] : []
      })
      .sort((a, b) => a.show.name.localeCompare(b.show.name))

    const formats = [...new Set(source.artifacts.map((a) => a.format))].sort()
    let earliestCapturedAt: Date | null = null
    let latestVerifiedAt: Date | null = null
    for (const a of source.artifacts) {
      if (a.capturedAt && (earliestCapturedAt === null || a.capturedAt < earliestCapturedAt)) {
        earliestCapturedAt = a.capturedAt
      }
      if (a.verifiedAt && (latestVerifiedAt === null || a.verifiedAt > latestVerifiedAt)) {
        latestVerifiedAt = a.verifiedAt
      }
    }

    let documents: Array<{
      recordId: string
      title: string
      originalUrl: string | null
      episode: EpisodeRef
      showSlug: string | null
      contributionCount: number
      revision: string | null
    }> = []
    if (source.kind === 'capsule') {
      const docRows = await prisma.sourceRecord.findMany({
        where: { sourceId: source.id, kind: 'compiled_document' },
        select: {
          recordId: true,
          title: true,
          originalUrl: true,
          metadata: true,
          _count: { select: { contributions: true } },
          associations: {
            where: { status: 'accepted' },
            select: {
              episode: {
                select: {
                  slug: true,
                  title: true,
                  seasonNumber: true,
                  number: true,
                  show: { select: { slug: true } },
                },
              },
            },
            take: 1,
          },
        },
      })
      documents = docRows
        .map((r) => ({
          recordId: r.recordId,
          title: r.title,
          originalUrl: r.originalUrl,
          episode: r.associations[0]?.episode ?? null,
          showSlug: r.associations[0]?.episode?.show.slug ?? null,
          contributionCount: r._count.contributions,
          revision: revisionOf(r.metadata),
        }))
        .sort((a, b) => episodeSort(a.episode, b.episode) || a.title.localeCompare(b.title))
    }

    return {
      key: source.key,
      name: source.name,
      kind: source.kind,
      legacy: source.legacy,
      publication: source.publication,
      notes: source.notes,
      originalStatus: source.originalStatus,
      recordCount: source.recordCount,
      observationCount: source.observationCount,
      coverageFrom: isoDateOrNull(source.coverageFrom),
      coverageTo: isoDateOrNull(source.coverageTo),
      homeUrl: source.homeUrl,
      collectionUrl: source.collectionUrl,
      custodian: source.custodian,
      shows: source.archives
        .map((a) => ({
          slug: a.show.slug,
          name: a.show.name,
          messageCount: a.messageCount,
          threadCount: a.threadCount,
        }))
        .sort((a, b) => a.name.localeCompare(b.name)),
      artifacts: {
        count: source.artifacts.length,
        formats,
        earliestCapturedAt: isoOrNull(earliestCapturedAt),
        latestVerifiedAt: isoOrNull(latestVerifiedAt),
      },
      dispositions,
      documents,
    }
  }),

  // The sources feeding one show: its archives' communities plus any source with
  // reviewed record dispositions for the show (capsule sources have no archive).
  forShow: publicProcedure.input(slugInput).query(async ({ input }) => {
    const show = await prisma.show.findUnique({
      where: { slug: input.slug },
      select: { id: true, slug: true, name: true },
    })
    if (!show) throw new TRPCError({ code: 'NOT_FOUND' })

    const archives = await prisma.archive.findMany({
      where: { showId: show.id },
      select: {
        messageCount: true,
        threadCount: true,
        firstPostAt: true,
        lastPostAt: true,
        source: { select: sourceListingSelect },
      },
    })
    const rsRows = await prisma.recordShow.findMany({
      where: { showId: show.id },
      select: { status: true, record: { select: { sourceId: true, kind: true } } },
    })

    type ShowAgg = DispCounts & { documents: number }
    const dispBySource = new Map<number, ShowAgg>()
    for (const r of rsRows) {
      const sid = r.record.sourceId
      let cur = dispBySource.get(sid)
      if (!cur) {
        cur = { accepted: 0, context: 0, excluded: 0, needsReview: 0, documents: 0 }
        dispBySource.set(sid, cur)
      }
      if (r.status === 'accepted') {
        cur.accepted += 1
        if (r.record.kind === 'compiled_document') cur.documents += 1
      } else if (r.status === 'context') cur.context += 1
      else if (r.status === 'excluded') cur.excluded += 1
      else if (r.status === 'needs_review') cur.needsReview += 1
    }

    type ArchiveAgg = {
      messageCount: number
      threadCount: number
      firstPostAt: Date | null
      lastPostAt: Date | null
    }
    const archiveBySource = new Map<number, ArchiveAgg>()
    const sourceById = new Map<number, Prisma.SourceGetPayload<{ select: typeof sourceListingSelect }>>()
    for (const a of archives) {
      if (!a.source) continue
      sourceById.set(a.source.id, a.source)
      archiveBySource.set(a.source.id, {
        messageCount: a.messageCount,
        threadCount: a.threadCount,
        firstPostAt: a.firstPostAt,
        lastPostAt: a.lastPostAt,
      })
    }
    const extraIds = [...dispBySource.keys()].filter((id) => !sourceById.has(id))
    if (extraIds.length) {
      const extra = await prisma.source.findMany({
        where: { id: { in: extraIds } },
        select: sourceListingSelect,
      })
      for (const s of extra) sourceById.set(s.id, s)
    }

    const sources = [...sourceById.values()]
      .map((s) => {
        const arch = archiveBySource.get(s.id)
        const disp =
          dispBySource.get(s.id) ??
          ({ accepted: 0, context: 0, excluded: 0, needsReview: 0, documents: 0 } satisfies ShowAgg)
        return {
          key: s.key,
          name: s.name,
          kind: s.kind,
          legacy: s.legacy,
          publication: s.publication,
          homeUrl: s.homeUrl,
          collectionUrl: s.collectionUrl,
          custodian: s.custodian,
          notes: s.notes,
          coverageFrom: isoDateOrNull(s.coverageFrom),
          coverageTo: isoDateOrNull(s.coverageTo),
          messageCount: arch?.messageCount ?? 0,
          threadCount: arch?.threadCount ?? 0,
          firstPostAt: isoOrNull(arch?.firstPostAt ?? null),
          lastPostAt: isoOrNull(arch?.lastPostAt ?? null),
          accepted: disp.accepted,
          context: disp.context,
          excluded: disp.excluded,
          needsReview: disp.needsReview,
          documents: disp.documents,
        }
      })
      .sort(
        (a, b) => (a.legacy === b.legacy ? 0 : a.legacy ? -1 : 1) || a.name.localeCompare(b.name)
      )

    return { show: { slug: show.slug, name: show.name }, sources }
  }),

  // The stable preserved-record view for a public source's post. 404 unless the
  // source is public and the record is a servable (accepted/context) non-spam post.
  record: publicProcedure
    .input(z.object({ key: z.string().min(1), recordId: z.string().min(1) }))
    .query(async ({ input }) => {
      const source = await prisma.source.findUnique({
        where: { key: input.key },
        select: { id: true, key: true, name: true, kind: true, publication: true },
      })
      if (!source || source.publication !== 'public') throw new TRPCError({ code: 'NOT_FOUND' })

      const record = await prisma.sourceRecord.findUnique({
        where: { recordId: input.recordId },
        select: {
          sourceId: true,
          kind: true,
          isSpam: true,
          canonicalId: true,
          title: true,
          authorName: true,
          postedAt: true,
          postedDate: true,
          datePrecision: true,
          dateRaw: true,
          dateTimezone: true,
          externalId: true,
          originalUrl: true,
          body: true,
          source: { select: sourceLocationSourceSelect },
          observations: {
            select: {
              capturedAt: true,
              capturedPageUrl: true,
              archiveCollectionId: true,
              archiveUrl: true,
              locator: true,
              differsFromRecord: true,
              verifiedAt: true,
            },
          },
          associations: {
            select: {
              status: true,
              showId: true,
              show: { select: { slug: true, name: true } },
              episode: { select: { slug: true, title: true, seasonNumber: true, number: true } },
            },
          },
          memberships: {
            select: { message: { select: { thread: { select: { slug: true, showId: true } } } } },
          },
        },
      })
      if (!record || record.sourceId !== source.id || record.kind !== 'post' || record.isSpam) {
        throw new TRPCError({ code: 'NOT_FOUND' })
      }
      const servable = record.associations.some(
        (a) => a.status === 'accepted' || a.status === 'context'
      )
      if (!servable) throw new TRPCError({ code: 'NOT_FOUND' })

      const location = sourceLocationFor(
        record.source,
        { recordId: input.recordId, externalId: record.externalId, originalUrl: record.originalUrl },
        record.observations
      )

      const alsoRows = await prisma.sourceRecord.findMany({
        where: { canonicalId: record.canonicalId, NOT: { recordId: input.recordId } },
        select: { recordId: true, source: { select: sourceRefSelect } },
      })

      const threadByShow = new Map<number, string>()
      for (const m of record.memberships) {
        const th = m.message.thread
        if (!threadByShow.has(th.showId)) threadByShow.set(th.showId, th.slug)
      }

      return {
        source: { key: source.key, name: source.name, kind: source.kind },
        title: record.title,
        authorName: record.authorName,
        postedAt: isoOrNull(record.postedAt),
        postedDate: isoDateOrNull(record.postedDate),
        datePrecision: record.datePrecision,
        dateRaw: record.dateRaw,
        dateTimezone: record.dateTimezone,
        body: record.body,
        location,
        observations: record.observations.map((o) => ({
          capturedAt: isoOrNull(o.capturedAt),
          capturedPageUrl: o.capturedPageUrl,
          archivedUrl:
            record.source.kind === 'forum' && o.capturedAt && o.capturedPageUrl
              ? `https://web.archive.org/web/${waybackStamp(o.capturedAt)}/${o.capturedPageUrl}#p${record.externalId}`
              : null,
          archiveCollectionId: o.archiveCollectionId,
          archiveUrl: o.archiveUrl,
          locator: o.locator,
          differsFromRecord: o.differsFromRecord,
          verifiedAt: isoOrNull(o.verifiedAt),
        })),
        alsoSeenIn: alsoRows.map((r) => ({
          source: { key: r.source.key, name: r.source.name, kind: r.source.kind },
          recordId: r.recordId,
        })),
        shows: record.associations.map((a) => {
          const slug = threadByShow.get(a.showId)
          return {
            slug: a.show.slug,
            name: a.show.name,
            status: a.status,
            episode: a.episode
              ? {
                  slug: a.episode.slug,
                  title: a.episode.title,
                  seasonNumber: a.episode.seasonNumber,
                  number: a.episode.number,
                }
              : null,
            thread: slug !== undefined ? { slug } : null,
          }
        }),
      }
    }),
})
