// Stage `parse`: mbox → messages.jsonl (one ParsedMessage per line) + a summary.
import { join } from 'node:path'
import { readMbox } from '../lib/mbox'
import { decodeBody, header, parseHeaders, splitMessage } from '../lib/mime'
import { countLines, normalizeSubject, parseDate, parseFrom, parseMessageIdList, posterKey } from '../lib/normalize'
import { detectSpam } from '../lib/spam'
import { checkpointExists, writeJson, writeJsonl } from '../lib/checkpoint'
import type { ParsedMessage, StageContext } from '../lib/types'

type Summary = {
  total: number
  written: number
  noMessageId: number
  noDate: number
  dateOnly: number
  spam: Record<string, number>
  charsets: Record<string, number>
  durationMs: number
}

function extractCharset(ct: string | null): string {
  if (ct === null) return 'none'
  const m = ct.match(/charset\s*=\s*"?([^";\s]+)/i)
  return m && m[1] !== undefined ? m[1].toLowerCase() : 'none'
}

async function* parseMessages(ctx: StageContext, summary: Summary): AsyncGenerator<ParsedMessage> {
  const startTime = Date.now()
  for await (const bytes of readMbox(ctx.paths.archive)) {
    summary.total++
    const { headerBytes, bodyBytes } = splitMessage(bytes)
    const h = parseHeaders(headerBytes)

    const messageId = parseMessageIdList(header(h, 'message-id'))[0]
    if (messageId === undefined) {
      summary.noMessageId++
      continue
    }

    const { display, norm } = normalizeSubject(header(h, 'subject') ?? '')
    const from = parseFrom(header(h, 'from') ?? '')
    const parsedDate = parseDate(h)
    const postedAt = parsedDate?.iso ?? null
    const dateOnly = parsedDate?.dateOnly ?? false
    if (postedAt === null) summary.noDate++
    if (dateOnly) summary.dateOnly++
    const references = parseMessageIdList(header(h, 'references'))
    const inReplyTo = parseMessageIdList(header(h, 'in-reply-to'))[0] ?? null
    const newsgroups = (header(h, 'newsgroups') ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
    const body = decodeBody(bodyBytes, h)
    const spamReason = detectSpam({ subject: display, body, newsgroups, postedAt })
    if (spamReason !== null) summary.spam[spamReason] = (summary.spam[spamReason] ?? 0) + 1

    const charset = extractCharset(header(h, 'content-type'))
    summary.charsets[charset] = (summary.charsets[charset] ?? 0) + 1

    yield {
      messageId,
      subject: display,
      subjectNorm: norm,
      fromName: from.name,
      posterKey: posterKey(from.email, from.name),
      postedAt,
      dateOnly,
      references,
      inReplyTo,
      newsgroups,
      body,
      lineCount: countLines(body),
      isSpam: spamReason !== null,
      spamReason,
    }

    if (summary.total % 10000 === 0) {
      const rate = summary.total / ((Date.now() - startTime) / 1000)
      ctx.log(`parse: ${summary.total} messages (${rate.toFixed(0)} msg/s)`)
    }
  }
}

export async function run(ctx: StageContext): Promise<void> {
  const out = join(ctx.paths.work, 'messages.jsonl')
  const summaryPath = join(ctx.paths.work, 'parse-summary.json')
  if (!ctx.force && checkpointExists(out)) {
    ctx.log('parse: messages.jsonl exists, skipping (use --force)')
    return
  }
  const started = Date.now()
  const summary: Summary = {
    total: 0,
    written: 0,
    noMessageId: 0,
    noDate: 0,
    dateOnly: 0,
    spam: {},
    charsets: {},
    durationMs: 0,
  }
  summary.written = await writeJsonl(out, parseMessages(ctx, summary))
  summary.durationMs = Date.now() - started
  writeJson(summaryPath, summary)
  ctx.log(
    `parse: wrote ${summary.written}/${summary.total} messages ` +
      `(${summary.noMessageId} no message-id, ${summary.noDate} no date, ${summary.dateOnly} date-only) in ${(summary.durationMs / 1000).toFixed(1)}s`
  )
}
