// Stage: attribute — heuristic episode candidates for every non-spam thread.
// Reads threaded.jsonl (for body/subject text) and threads.jsonl (for timing),
// writes candidates.jsonl + attribute-summary.json.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  AliasesFile,
  CandidateRecord,
  EpisodesFile,
  ThreadRecord,
  ThreadedMessage,
  type Stage,
} from '../lib/types'
import { buildEpisodeIndex } from '../lib/episode-index'
import { scoreThread, type ThreadText } from '../lib/scoring'
import { withoutQuotedLines } from '../lib/text'
import { checkpointExists, readJsonl, writeJson, writeJsonl } from '../lib/checkpoint'

const ROOT_LIMIT = 3000
const REPLY_LIMIT = 1500
const MAX_REPLIES = 2

type ThreadAcc = {
  rootBody: string | null
  rootPostedAt: string | null
  replies: { postedAt: string; body: string }[]
  replySubjects: Set<string>
}

function clean(body: string, limit: number): string {
  return withoutQuotedLines(body).toLowerCase().slice(0, limit)
}

function keepEarliest(replies: { postedAt: string; body: string }[], item: { postedAt: string; body: string }): void {
  replies.push(item)
  replies.sort((a, b) => (a.postedAt < b.postedAt ? -1 : a.postedAt > b.postedAt ? 1 : 0))
  if (replies.length > MAX_REPLIES) replies.length = MAX_REPLIES
}

function signalCategory(sig: string): string {
  if (sig.startsWith('window:')) return 'window'
  if (sig === 'title:subject' || sig === 'alias:subject') return sig
  if (sig.startsWith('title:')) return 'title:body'
  if (sig.startsWith('alias:')) return 'alias:body'
  return sig
}

export const run: Stage['run'] = async (ctx) => {
  const candidatesPath = join(ctx.paths.work, 'candidates.jsonl')
  if (checkpointExists(candidatesPath) && !ctx.force) {
    ctx.log('attribute: cached')
    return
  }

  const episodes = EpisodesFile.parse(JSON.parse(readFileSync(ctx.paths.episodesFile, 'utf8')))
  const aliases = AliasesFile.parse(JSON.parse(readFileSync(ctx.paths.aliasesFile, 'utf8')))
  const index = buildEpisodeIndex(episodes, aliases)

  // Pass 1: gather bounded per-thread text from threaded.jsonl.
  const byThread = new Map<string, ThreadAcc>()
  const threadedPath = join(ctx.paths.work, 'threaded.jsonl')
  for await (const m of readJsonl(threadedPath, ThreadedMessage)) {
    let acc = byThread.get(m.threadKey)
    if (!acc) {
      acc = { rootBody: null, rootPostedAt: null, replies: [], replySubjects: new Set() }
      byThread.set(m.threadKey, acc)
    }
    if (m.depth === 0) {
      if (acc.rootPostedAt === null || m.postedAt < acc.rootPostedAt) {
        acc.rootBody = clean(m.body, ROOT_LIMIT)
        acc.rootPostedAt = m.postedAt
      }
    } else {
      acc.replySubjects.add(m.subjectNorm)
      keepEarliest(acc.replies, { postedAt: m.postedAt, body: clean(m.body, REPLY_LIMIT) })
    }
  }

  // Pass 2: score threads.jsonl, streaming CandidateRecords out.
  const bySignal: Record<string, number> = {}
  const topScores: { subject: string; key: string; score: number }[] = []
  let threads = 0
  let scored = 0
  let inLiveWindow = 0
  const threadsPath = join(ctx.paths.work, 'threads.jsonl')

  async function* records(): AsyncGenerator<CandidateRecord> {
    for await (const t of readJsonl(threadsPath, ThreadRecord)) {
      threads++
      if (t.isSpam) continue
      const acc = byThread.get(t.threadKey)
      const text: ThreadText = {
        subject: t.subjectNorm,
        rootBody: acc?.rootBody ?? '',
        replySubjects: acc ? [...acc.replySubjects] : [],
        replyBodies: acc ? acc.replies.map((r) => r.body) : [],
      }
      const result = scoreThread(t.startedAt, text, index, ctx.show.liveWindowDays)
      if (result.inLiveWindow) inLiveWindow++
      if (result.candidates.length === 0) continue
      scored++
      for (const c of result.candidates) {
        for (const s of c.signals) {
          const cat = signalCategory(s)
          bySignal[cat] = (bySignal[cat] ?? 0) + 1
        }
      }
      const top = result.candidates[0]
      if (top) topScores.push({ subject: t.subject, key: top.key, score: top.score })
      yield { threadKey: t.threadKey, candidates: result.candidates, inLiveWindow: result.inLiveWindow }
    }
  }

  const written = await writeJsonl(candidatesPath, records())

  topScores.sort((a, b) => b.score - a.score)
  writeJson(join(ctx.paths.work, 'attribute-summary.json'), {
    threads,
    scored,
    inLiveWindow,
    bySignal,
    topScores: topScores.slice(0, 20),
  })

  ctx.log(`attributed ${scored}/${threads} threads (${inLiveWindow} in live window), wrote ${written} candidate records`)
}
