// Stage `thread`: messages.jsonl → threaded.jsonl + threads.jsonl + a summary.
import { join } from 'node:path'
import { checkpointExists, readJsonl, writeJson, writeJsonl } from '../lib/checkpoint'
import { threadMessages } from '../lib/jwz'
import { ParsedMessage, type StageContext } from '../lib/types'

export async function run(ctx: StageContext): Promise<void> {
  const messagesPath = join(ctx.paths.work, 'messages.jsonl')
  const threadsPath = join(ctx.paths.work, 'threads.jsonl')
  const threadedPath = join(ctx.paths.work, 'threaded.jsonl')
  const summaryPath = join(ctx.paths.work, 'thread-summary.json')

  if (!ctx.force && checkpointExists(threadsPath) && checkpointExists(threadedPath)) {
    ctx.log('thread: outputs exist, skipping (use --force)')
    return
  }

  const messages: ParsedMessage[] = []
  for await (const m of readJsonl(messagesPath, ParsedMessage)) messages.push(m)
  ctx.log(`thread: loaded ${messages.length} messages`)

  const { threads, threaded, summary } = threadMessages(messages)
  await writeJsonl(threadsPath, threads)
  await writeJsonl(threadedPath, threaded)

  const largestThreads = [...threads]
    .sort((a, b) => b.messageCount - a.messageCount)
    .slice(0, 10)
    .map((t) => ({ subject: t.subject, messageCount: t.messageCount, startedAt: t.startedAt }))
  writeJson(summaryPath, { ...summary, largestThreads })

  ctx.log(
    `thread: ${threads.length} threads, ${threaded.length} messages, ` +
      `${summary.subjectMerges} subject-merges, ${summary.phantomRoots} phantom roots, ${summary.droppedNoDate} dropped`
  )
}
