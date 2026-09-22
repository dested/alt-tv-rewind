// `pipeline sources report` — reconcile the catalog and the projection into one
// counts file (data/work/sources/report.json) and print a compact table. Every
// number is a grouped SQL query validated through zod; the catalog run summaries
// are read only to confirm they exist and match. Safe to run at any stage — the
// figures reflect whatever has been cataloged/imported so far.
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'
import { withClient } from '../lib/db'
import { writeJson } from '../lib/checkpoint'
import { WORK_DIR } from './cli'

// Legacy expectation from the handoff: the one-newsgroup pipeline's message total.
const LEGACY_EXPECTED = 665499

// ── row schemas ──────────────────────────────────────────────────────────────

const SourceRow = z.object({
  key: z.string(),
  kind: z.string(),
  legacy: z.boolean(),
  records: z.number().int(),
  observations: z.number().int(),
  variants: z.number().int(),
  spam: z.number().int(),
  missing_id: z.number().int(),
  undated: z.number().int(),
  day_only: z.number().int(),
  long_bodies: z.number().int(),
  artifacts: z.number().int(),
})

const ShowRow = z.object({ id: z.number().int(), slug: z.string() })
const ShowCountRow = z.object({ show_id: z.number().int(), key: z.string(), n: z.number().int() })
type ShowCount = z.infer<typeof ShowCountRow>
const InEraRow = z.object({ show_id: z.number().int(), in_era: z.boolean(), status: z.string(), n: z.number().int() })
const ImportedRow = z.object({
  show_id: z.number().int(),
  messages: z.number().int(),
  linked: z.number().int(),
  pending: z.number().int(),
})
const ArchiveRow = z.object({
  show_id: z.number().int(),
  source: z.string().nullable(),
  newsgroup: z.string(),
  message_count: z.number().int(),
  thread_count: z.number().int(),
  first_post_at: z.string().nullable(),
  last_post_at: z.string().nullable(),
})
const ThreadTotalRow = z.object({ show_id: z.number().int(), total: z.number().int() })
const CapsuleRow = z.object({
  show_id: z.number().int(),
  documents: z.number().int(),
  mapped: z.number().int(),
  unresolved: z.number().int(),
})
const LegacyRow = z.object({ messages: z.number().int(), threads: z.number().int() })

// ── output shape ─────────────────────────────────────────────────────────────

type ArchiveReport = {
  source: string | null
  newsgroup: string
  messageCount: number
  threadCount: number
  firstPostAt: string | null
  lastPostAt: string | null
}
type ShowReport = {
  slug: string
  dispositions: Record<string, number>
  byMethod: Record<string, number>
  byReason: Record<string, number>
  inEra: { accepted: number; context: number }
  later: { accepted: number; context: number }
  imported: { messages: number; linked: number; pending: number }
  archives: ArchiveReport[]
  importedThreads: { total: number; byMethod: Record<string, number>; live: number; retro: number; unattributed: number }
  capsules: { documents: number; mapped: number; unresolved: number; contributions: Record<string, number> }
}
type SourceOut = {
  key: string
  kind: string
  legacy: boolean
  records: number
  observations: number
  variants: number
  spam: number
  missingId: number
  undated: number
  dayOnly: number
  longBodies: number
  artifacts: number
}
type Report = {
  generatedAt: string
  sources: SourceOut[]
  shows: ShowReport[]
  legacy: { messages: number; threads: number; expected: number }
}

// Folds grouped (show_id, key, n) rows into per-show Record<key, number>.
function bucket(rows: ShowCount[]): Map<number, Record<string, number>> {
  const out = new Map<number, Record<string, number>>()
  for (const r of rows) {
    const m = out.get(r.show_id) ?? {}
    m[r.key] = r.n
    out.set(r.show_id, m)
  }
  return out
}

export async function writeReport(log: (s: string) => void): Promise<void> {
  const report = await withClient(async (c) => {
    // node-pg types rows as any[]; this hands every row across a zod boundary
    // as unknown, so no query result is trusted untyped.
    const q = async (sql: string, params: unknown[] = []): Promise<unknown[]> => (await c.query(sql, params)).rows

    // ── sources ────────────────────────────────────────────────────────────
    const sourceRows = (
      await q(
        `SELECT s.key, s.kind::text AS kind, s.legacy,
           (SELECT count(*)::int FROM source_record r WHERE r.source_id = s.id) AS records,
           (SELECT count(*)::int FROM observation o JOIN source_record r ON r.id = o.record_id WHERE r.source_id = s.id) AS observations,
           (SELECT count(*)::int FROM observation o JOIN source_record r ON r.id = o.record_id WHERE r.source_id = s.id AND o.differs_from_record) AS variants,
           (SELECT count(*)::int FROM source_record r WHERE r.source_id = s.id AND r.is_spam) AS spam,
           (SELECT count(*)::int FROM source_record r WHERE r.source_id = s.id AND r.identity_method = 'raw-sha256') AS missing_id,
           (SELECT count(*)::int FROM source_record r WHERE r.source_id = s.id AND r.posted_at IS NULL AND r.posted_date IS NULL) AS undated,
           (SELECT count(*)::int FROM source_record r WHERE r.source_id = s.id AND r.date_precision = 'day') AS day_only,
           (SELECT count(*)::int FROM source_record r WHERE r.source_id = s.id AND r.body_length > 65536) AS long_bodies,
           (SELECT count(*)::int FROM artifact a WHERE a.source_id = s.id) AS artifacts
         FROM source s ORDER BY s.legacy, s.key`
      )
    ).map((r) => SourceRow.parse(r))

    // ── shows that have any disposition ──────────────────────────────────────
    const shows = (await q(`SELECT DISTINCT sh.id, sh.slug FROM show sh JOIN record_show rs ON rs.show_id = sh.id ORDER BY sh.slug`)).map(
      (r) => ShowRow.parse(r)
    )

    const dispositions = bucket(
      (await q(`SELECT show_id, status::text AS key, count(*)::int AS n FROM record_show GROUP BY show_id, status`)).map((r) =>
        ShowCountRow.parse(r)
      )
    )
    const byMethod = bucket(
      (await q(`SELECT show_id, method AS key, count(*)::int AS n FROM record_show GROUP BY show_id, method`)).map((r) =>
        ShowCountRow.parse(r)
      )
    )
    const byReason = bucket(
      (await q(`SELECT show_id, reason AS key, count(*)::int AS n FROM record_show WHERE reason IS NOT NULL GROUP BY show_id, reason`)).map(
        (r) => ShowCountRow.parse(r)
      )
    )
    const inEraRows = (
      await q(
        `SELECT show_id, in_era, status::text AS status, count(*)::int AS n
         FROM record_show WHERE status IN ('accepted','context') GROUP BY show_id, in_era, status`
      )
    ).map((r) => InEraRow.parse(r))
    const importedRows = (
      await q(
        `SELECT show_id,
           count(*) FILTER (WHERE import_status = 'imported')::int AS messages,
           count(*) FILTER (WHERE import_status = 'linked')::int AS linked,
           count(*) FILTER (WHERE status IN ('accepted','context') AND import_status = 'pending')::int AS pending
         FROM record_show GROUP BY show_id`
      )
    ).map((r) => ImportedRow.parse(r))
    const archiveRows = (
      await q(
        `SELECT a.show_id, s.key AS source, a.newsgroup, a.message_count, a.thread_count,
           to_char(a.first_post_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS first_post_at,
           to_char(a.last_post_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS last_post_at
         FROM archive a LEFT JOIN source s ON s.id = a.source_id ORDER BY a.show_id, a.newsgroup`
      )
    ).map((r) => ArchiveRow.parse(r))
    const threadTotals = new Map(
      (await q(`SELECT show_id, count(*)::int AS total FROM thread WHERE import_key IS NOT NULL GROUP BY show_id`))
        .map((r) => ThreadTotalRow.parse(r))
        .map((r) => [r.show_id, r.total] as const)
    )
    const threadMethod = bucket(
      (
        await q(
          `SELECT t.show_id, te.method AS key, count(*)::int AS n
           FROM thread t JOIN thread_episode te ON te.thread_id = t.id
           WHERE t.import_key IS NOT NULL GROUP BY t.show_id, te.method`
        )
      ).map((r) => ShowCountRow.parse(r))
    )
    // Relation counted over primary attributions only, so a thread with both a
    // live and a retro secondary is not double counted.
    const threadRelation = bucket(
      (
        await q(
          `SELECT t.show_id, te.relation::text AS key, count(*)::int AS n
           FROM thread t JOIN thread_episode te ON te.thread_id = t.id AND te.is_primary
           WHERE t.import_key IS NOT NULL GROUP BY t.show_id, te.relation`
        )
      ).map((r) => ShowCountRow.parse(r))
    )
    const threadUnattributed = new Map(
      (
        await q(
          `SELECT t.show_id, count(*)::int AS total
           FROM thread t
           WHERE t.import_key IS NOT NULL AND NOT EXISTS (SELECT 1 FROM thread_episode te WHERE te.thread_id = t.id)
           GROUP BY t.show_id`
        )
      )
        .map((r) => ThreadTotalRow.parse(r))
        .map((r) => [r.show_id, r.total] as const)
    )
    const capsuleRows = new Map(
      (
        await q(
          `SELECT rs.show_id,
             count(DISTINCT r.id)::int AS documents,
             count(DISTINCT r.id) FILTER (WHERE rs.status = 'accepted' AND rs.episode_id IS NOT NULL)::int AS mapped,
             count(DISTINCT r.id) FILTER (WHERE rs.status = 'needs_review')::int AS unresolved
           FROM record_show rs JOIN source_record r ON r.id = rs.record_id
           WHERE r.kind = 'compiled_document' GROUP BY rs.show_id`
        )
      )
        .map((r) => CapsuleRow.parse(r))
        .map((r) => [r.show_id, r] as const)
    )
    const contributions = bucket(
      (
        await q(
          `SELECT rs.show_id, c.kind::text AS key, count(*)::int AS n
           FROM contribution c
           JOIN source_record r ON r.id = c.record_id
           JOIN record_show rs ON rs.record_id = r.id
           GROUP BY rs.show_id, c.kind`
        )
      ).map((r) => ShowCountRow.parse(r))
    )

    const legacy = LegacyRow.parse(
      (
        await q(
          `SELECT
             (SELECT count(*)::int FROM message m JOIN archive a ON a.id = m.archive_id JOIN source s ON s.id = a.source_id WHERE s.legacy) AS messages,
             (SELECT count(*)::int FROM thread t JOIN archive a ON a.id = t.archive_id JOIN source s ON s.id = a.source_id WHERE s.legacy) AS threads`
        )
      )[0]
    )

    // ── assemble per-show ────────────────────────────────────────────────────
    const importedById = new Map(importedRows.map((r) => [r.show_id, r]))
    const showReports: ShowReport[] = shows.map((sh) => {
      const inEra = { accepted: 0, context: 0 }
      const later = { accepted: 0, context: 0 }
      for (const r of inEraRows) {
        if (r.show_id !== sh.id) continue
        const target = r.in_era ? inEra : later
        if (r.status === 'accepted') target.accepted += r.n
        else if (r.status === 'context') target.context += r.n
      }
      const imp = importedById.get(sh.id) ?? { messages: 0, linked: 0, pending: 0 }
      const rel = threadRelation.get(sh.id) ?? {}
      const cap = capsuleRows.get(sh.id) ?? { documents: 0, mapped: 0, unresolved: 0 }
      return {
        slug: sh.slug,
        dispositions: dispositions.get(sh.id) ?? {},
        byMethod: byMethod.get(sh.id) ?? {},
        byReason: byReason.get(sh.id) ?? {},
        inEra,
        later,
        imported: { messages: imp.messages, linked: imp.linked, pending: imp.pending },
        archives: archiveRows
          .filter((a) => a.show_id === sh.id)
          .map((a) => ({
            source: a.source,
            newsgroup: a.newsgroup,
            messageCount: a.message_count,
            threadCount: a.thread_count,
            firstPostAt: a.first_post_at,
            lastPostAt: a.last_post_at,
          })),
        importedThreads: {
          total: threadTotals.get(sh.id) ?? 0,
          byMethod: threadMethod.get(sh.id) ?? {},
          live: rel['live'] ?? 0,
          retro: rel['retro'] ?? 0,
          unattributed: threadUnattributed.get(sh.id) ?? 0,
        },
        capsules: {
          documents: cap.documents,
          mapped: cap.mapped,
          unresolved: cap.unresolved,
          contributions: contributions.get(sh.id) ?? {},
        },
      }
    })

    const out: Report = {
      generatedAt: new Date().toISOString(),
      sources: sourceRows.map((s) => ({
        key: s.key,
        kind: s.kind,
        legacy: s.legacy,
        records: s.records,
        observations: s.observations,
        variants: s.variants,
        spam: s.spam,
        missingId: s.missing_id,
        undated: s.undated,
        dayOnly: s.day_only,
        longBodies: s.long_bodies,
        artifacts: s.artifacts,
      })),
      shows: showReports,
      legacy: { messages: legacy.messages, threads: legacy.threads, expected: LEGACY_EXPECTED },
    }
    return out
  })

  // Catalog run summaries are supplementary evidence; read (and validate as
  // objects) if present so a mismatch or a missing file surfaces here, not later.
  const summarySpec = z.object({}).passthrough()
  const summaries = ['usenet-catalog-summary.json', 'forum-catalog-summary.json', 'capsule-catalog-summary.json']
  for (const sh of report.shows) summaries.push(`import-${sh.slug}-summary.json`)
  const present: string[] = []
  for (const name of summaries) {
    const path = join(WORK_DIR, name)
    if (!existsSync(path)) continue
    summarySpec.parse(JSON.parse(readFileSync(path, 'utf8')))
    present.push(name)
  }

  const outPath = join(WORK_DIR, 'report.json')
  writeJson(outPath, report)
  printTable(report, present, log)
  log(`report → ${outPath}`)
}

function printTable(report: Report, summaries: string[], log: (s: string) => void): void {
  log('sources:')
  for (const s of report.sources) {
    log(
      `  ${s.key.padEnd(38)} ${s.kind.padEnd(7)} ${s.legacy ? 'legacy' : 'cataloged'}  ` +
        `records=${s.records} obs=${s.observations} variants=${s.variants} spam=${s.spam} ` +
        `missingId=${s.missingId} undated=${s.undated} dayOnly=${s.dayOnly} longBodies=${s.longBodies} artifacts=${s.artifacts}`
    )
  }
  for (const sh of report.shows) {
    log(`show ${sh.slug}:`)
    log(`  dispositions ${fmt(sh.dispositions)}`)
    log(`  byMethod     ${fmt(sh.byMethod)}`)
    if (Object.keys(sh.byReason).length > 0) log(`  byReason     ${fmt(sh.byReason)}`)
    log(`  inEra        accepted=${sh.inEra.accepted} context=${sh.inEra.context}  |  later accepted=${sh.later.accepted} context=${sh.later.context}`)
    log(`  imported     messages=${sh.imported.messages} linked=${sh.imported.linked} pending=${sh.imported.pending}`)
    for (const a of sh.archives) {
      log(`  archive      ${(a.source ?? a.newsgroup).padEnd(38)} msgs=${a.messageCount} threads=${a.threadCount} ${a.firstPostAt ?? '—'}..${a.lastPostAt ?? '—'}`)
    }
    log(
      `  imported threads total=${sh.importedThreads.total} live=${sh.importedThreads.live} retro=${sh.importedThreads.retro} ` +
        `unattributed=${sh.importedThreads.unattributed} byMethod=${fmt(sh.importedThreads.byMethod)}`
    )
    if (sh.capsules.documents > 0) {
      log(
        `  capsules     documents=${sh.capsules.documents} mapped=${sh.capsules.mapped} unresolved=${sh.capsules.unresolved} ` +
          `contributions=${fmt(sh.capsules.contributions)}`
      )
    }
  }
  log(`legacy: messages=${report.legacy.messages} threads=${report.legacy.threads} expected=${report.legacy.expected}`)
  log(`catalog summaries present: ${summaries.length > 0 ? summaries.join(', ') : 'none'}`)
}

function fmt(rec: Record<string, number>): string {
  const entries = Object.entries(rec)
  if (entries.length === 0) return '(none)'
  return entries
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([k, v]) => `${k}=${v}`)
    .join(' ')
}
