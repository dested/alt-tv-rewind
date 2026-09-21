import { describe, expect, test } from 'bun:test'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { collectThreadInputs, extractCandidateLines } from './thread-text'
import type { ThreadedMessage, ThreadRecord, StageContext } from './types'

const KEY16 = 'a'.repeat(16)

function msg(over: Partial<ThreadedMessage> & Pick<ThreadedMessage, 'messageId' | 'postedAt' | 'body' | 'depth'>): ThreadedMessage {
  return {
    subject: 'Sub',
    subjectNorm: 'sub',
    fromName: 'Someone',
    posterKey: KEY16,
    dateOnly: false,
    references: [],
    inReplyTo: null,
    newsgroups: ['alt.tv.seinfeld'],
    lineCount: 1,
    isSpam: false,
    spamReason: null,
    threadKey: 't1',
    parentRef: null,
    ...over,
  }
}

function thread(over: Partial<ThreadRecord> & Pick<ThreadRecord, 'threadKey'>): ThreadRecord {
  return {
    rootMessageId: null,
    subject: 'Sub',
    subjectNorm: 'sub',
    startedAt: '1996-05-16T20:00:00.000Z',
    startedDateOnly: false,
    lastPostAt: '1996-05-17T20:00:00.000Z',
    messageCount: 1,
    posterCount: 1,
    maxDepth: 0,
    isSpam: false,
    ...over,
  }
}

function fakeCtx(work: string): StageContext {
  return {
    show: { slug: 'seinfeld', name: 'Seinfeld', newsgroup: 'alt.tv.seinfeld', tvmazeQuery: 'seinfeld', liveWindowDays: 10 },
    paths: {
      archive: '',
      work,
      showDir: '',
      episodesFile: '',
      aliasesFile: '',
      phrasesFile: '',
    },
    force: false,
    log: () => {},
  }
}

function writeWork(threads: ThreadRecord[], messages: ThreadedMessage[]): string {
  const dir = mkdtempSync(join(tmpdir(), 'thread-text-'))
  writeFileSync(join(dir, 'threads.jsonl'), threads.map((t) => JSON.stringify(t)).join('\n') + '\n')
  writeFileSync(join(dir, 'threaded.jsonl'), messages.map((m) => JSON.stringify(m)).join('\n') + '\n')
  return dir
}

describe('extractCandidateLines', () => {
  test('filters, dedupes case-insensitively, and labels L1..Ln', () => {
    const opener = {
      messageId: '<o>',
      text: [
        'This episode was the single best half hour of television all year.', // keep (L1)
        'THIS EPISODE WAS THE SINGLE BEST HALF HOUR OF TELEVISION ALL YEAR.', // dup (case-insensitive)
        'Too short here.', // < 25 chars
        'four words only here.', // < 5 words
        'Email me at bob@example.com about the finale details please.', // has @
        'Read more at http://example.com/finale for the full recap tonight.', // has http
        'THIS WHOLE THING IS COMPLETELY UNWATCHABLE GARBAGE AND YOU KNOW IT.', // all caps
        'On Tuesday Bob wrote that the finale would be terrible for everyone.', // On..wrote
      ].join('\n'),
    }
    const reply = { messageId: '<r>', text: 'The bottle-episode format really carried the entire second act tonight.' } // keep (L2)

    const lines = extractCandidateLines(opener, [reply])
    expect(lines).toHaveLength(2)
    expect(lines[0]).toEqual({
      label: 'L1',
      messageId: '<o>',
      text: 'This episode was the single best half hour of television all year.',
    })
    expect(lines[1]).toEqual({
      label: 'L2',
      messageId: '<r>',
      text: 'The bottle-episode format really carried the entire second act tonight.',
    })
  })

  test('respects the max cap', () => {
    const text = Array.from({ length: 10 }, (_, i) => `Candidate sentence number ${i} is long enough to keep here.`).join('\n')
    const lines = extractCandidateLines({ messageId: '<o>', text }, [], 3)
    expect(lines).toHaveLength(3)
    expect(lines.map((l) => l.label)).toEqual(['L1', 'L2', 'L3'])
  })
})

describe('collectThreadInputs', () => {
  test('cuts the signature, truncates per role, and computes hoursLater', async () => {
    const opener = msg({
      messageId: '<o>',
      postedAt: '1996-05-16T20:00:00.000Z',
      depth: 0,
      body: 'X'.repeat(50) + '\n-- \nSig line that must be dropped',
    })
    const reply = msg({
      messageId: '<r>',
      postedAt: '1996-05-16T22:30:00.000Z',
      depth: 1,
      body: 'Y'.repeat(50),
    })
    const dir = writeWork(
      [thread({ threadKey: 't1', rootMessageId: '<o>', messageCount: 2, startedAt: opener.postedAt })],
      [opener, reply],
    )

    const inputs = await collectThreadInputs(fakeCtx(dir), { openerChars: 20, replyChars: 30, maxReplies: 4 })
    const t = inputs.get('t1')
    expect(t).toBeDefined()
    expect(t!.opener!.text).toBe('X'.repeat(19) + '…') // truncated to 20 chars, signature gone
    expect(t!.opener!.text).not.toContain('Sig')
    expect(t!.replies).toHaveLength(1)
    expect(t!.replies[0]!.hoursLater).toBe(2.5)
    expect(t!.replies[0]!.text).toBe('Y'.repeat(29) + '…') // truncated to 30 chars
  })

  test('prefers the rootMessageId message as opener even when it is not earliest', async () => {
    const early = msg({ messageId: '<early>', postedAt: '1996-05-16T18:00:00.000Z', depth: 1, body: 'early body text' })
    const root = msg({ messageId: '<root>', postedAt: '1996-05-16T20:00:00.000Z', depth: 0, body: 'root body text' })
    const dir = writeWork(
      [thread({ threadKey: 't1', rootMessageId: '<root>', messageCount: 2, startedAt: root.postedAt })],
      [early, root],
    )
    const inputs = await collectThreadInputs(fakeCtx(dir), { openerChars: 100, replyChars: 100, maxReplies: 4 })
    const t = inputs.get('t1')!
    expect(t.opener!.messageId).toBe('<root>')
    expect(t.replies.map((r) => r.messageId)).toEqual(['<early>'])
    expect(t.replies[0]!.hoursLater).toBe(-2) // the earlier message sits before the root
  })

  test('applies the filter', async () => {
    const spam = msg({ messageId: '<s>', postedAt: '1996-05-16T20:00:00.000Z', depth: 0, body: 'buy now', threadKey: 't2' })
    const dir = writeWork(
      [thread({ threadKey: 't2', isSpam: true, messageCount: 1 })],
      [spam],
    )
    const inputs = await collectThreadInputs(fakeCtx(dir), {
      openerChars: 100,
      replyChars: 100,
      maxReplies: 4,
      filter: (t) => !t.isSpam,
    })
    expect(inputs.size).toBe(0)
  })
})
