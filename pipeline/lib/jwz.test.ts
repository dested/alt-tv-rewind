import { expect, test } from 'bun:test'
import { threadMessages } from './jwz'
import type { ParsedMessage, ThreadedMessage, ThreadRecord } from './types'

function msg(id: string, over: Partial<ParsedMessage>): ParsedMessage {
  return {
    messageId: id,
    subject: over.subject ?? 'Subject',
    subjectNorm: over.subjectNorm ?? 'subject',
    fromName: over.fromName ?? 'poster',
    posterKey: over.posterKey ?? id.replace(/[^a-z0-9]/g, '').padEnd(16, '0').slice(0, 16),
    postedAt: over.postedAt ?? null,
    dateOnly: over.dateOnly ?? false,
    references: over.references ?? [],
    inReplyTo: over.inReplyTo ?? null,
    newsgroups: over.newsgroups ?? ['alt.tv.seinfeld'],
    body: over.body ?? '',
    lineCount: over.lineCount ?? 0,
    isSpam: over.isSpam ?? false,
    spamReason: over.spamReason ?? null,
  }
}

function need<T>(v: T | undefined, label: string): T {
  if (v === undefined) throw new Error(`missing ${label}`)
  return v
}

const messages: ParsedMessage[] = [
  msg('<a>', { subjectNorm: 'kramer', subject: 'Kramer', postedAt: '2010-01-01T00:00:00.000Z' }),
  msg('<b>', { subjectNorm: 'kramer', subject: 'Kramer', postedAt: '2010-01-02T00:00:00.000Z', references: ['<a>'] }),
  msg('<c>', { subjectNorm: 'kramer', subject: 'Kramer', postedAt: null, references: ['<a>'] }),
  msg('<d>', { subjectNorm: 'kramer', subject: 'Kramer', postedAt: '2010-01-03T00:00:00.000Z', references: ['<a>', '<c>'] }),
  msg('<e>', { subjectNorm: 'kramer', subject: 'Kramer', postedAt: '2010-01-04T00:00:00.000Z', references: ['<x>', '<a>'] }),
  msg('<b>', { subjectNorm: 'kramer', subject: 'Kramer', postedAt: '2010-01-09T00:00:00.000Z', references: ['<a>'] }), // duplicate id
  msg('<f>', { subjectNorm: 'festivus', subject: 'Festivus', postedAt: '2010-02-01T00:00:00.000Z', inReplyTo: '<y>' }),
  msg('<m1>', { subjectNorm: 'soup nazi', subject: 'Soup Nazi', postedAt: '2010-03-01T00:00:00.000Z' }),
  msg('<m2>', { subjectNorm: 'soup nazi', subject: 'Soup Nazi', postedAt: '2010-03-06T00:00:00.000Z' }),
  msg('<n1>', { subjectNorm: 'parking garage', subject: 'Parking Garage', postedAt: '2010-04-01T00:00:00.000Z' }),
  msg('<n2>', { subjectNorm: 'parking garage', subject: 'Parking Garage', postedAt: '2010-10-20T00:00:00.000Z' }),
]

const { threads, threaded, summary } = threadMessages(messages)
const byId = new Map<string, ThreadedMessage>(threaded.map((t) => [t.messageId, t]))
const byKey = new Map<string, ThreadRecord>(threads.map((t) => [t.threadKey, t]))

test('summary counts', () => {
  expect(summary.threads).toBe(5)
  expect(summary.subjectMerges).toBe(1)
  expect(summary.phantomRoots).toBe(0)
  expect(summary.droppedNoDate).toBe(0)
  expect(summary.dupes).toBe(1)
})

test('threadKeys ordered by startedAt', () => {
  expect(need(byId.get('<a>'), 'a').threadKey).toBe('t0')
  expect(need(byId.get('<f>'), 'f').threadKey).toBe('t1')
  expect(need(byId.get('<m1>'), 'm1').threadKey).toBe('t2')
  expect(need(byId.get('<n1>'), 'n1').threadKey).toBe('t3')
  expect(need(byId.get('<n2>'), 'n2').threadKey).toBe('t4')
})

test('depths and parentRefs in the reference chain', () => {
  expect(need(byId.get('<a>'), 'a')).toMatchObject({ depth: 0, parentRef: null })
  expect(need(byId.get('<b>'), 'b')).toMatchObject({ depth: 1, parentRef: '<a>' })
  expect(need(byId.get('<c>'), 'c')).toMatchObject({ depth: 1, parentRef: '<a>' })
  expect(need(byId.get('<d>'), 'd')).toMatchObject({ depth: 2, parentRef: '<c>' })
  expect(need(byId.get('<e>'), 'e')).toMatchObject({ depth: 1, parentRef: '<a>' })
})

test('null date inherits the parent date', () => {
  expect(need(byId.get('<c>'), 'c').postedAt).toBe('2010-01-01T00:00:00.000Z')
})

test('orphan reply to a missing id becomes its own root', () => {
  const f = need(byId.get('<f>'), 'f')
  expect(f).toMatchObject({ depth: 0, parentRef: null })
  expect(need(byKey.get('t1'), 't1').rootMessageId).toBe('<f>')
})

test('same-subject roots 5 days apart merge; 200 days apart do not', () => {
  expect(need(byId.get('<m2>'), 'm2')).toMatchObject({ depth: 1, parentRef: '<m1>', threadKey: 't2' })
  expect(need(byKey.get('t2'), 't2').messageCount).toBe(2)
  expect(need(byId.get('<n1>'), 'n1').threadKey).not.toBe(need(byId.get('<n2>'), 'n2').threadKey)
})

test('thread record for the reference-chain thread', () => {
  const t0 = need(byKey.get('t0'), 't0')
  expect(t0.rootMessageId).toBe('<a>')
  expect(t0.messageCount).toBe(5)
  expect(t0.maxDepth).toBe(2)
  expect(t0.subject).toBe('Kramer')
})
