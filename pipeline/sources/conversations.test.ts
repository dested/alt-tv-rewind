import { expect, test } from 'bun:test'
import { buildConversations, type SlimRecord } from './conversations'

const sha = (s: string): string => new Bun.CryptoHasher('sha256').update(s).digest('hex')
const canon = (messageId: string): string => 'usenet:' + sha(messageId)

function rec(p: Partial<SlimRecord> & { recordId: string; sourceId: string; externalId: string }): SlimRecord {
  return {
    subject: p.subject ?? 'Subject',
    subjectNorm: p.subjectNorm ?? 'subject',
    canonicalId: p.canonicalId ?? canon(p.externalId),
    fromName: p.fromName ?? 'Someone',
    posterKey: p.posterKey ?? '0000000000000000',
    postedAt: p.postedAt === undefined ? '2006-01-01T00:00:00.000Z' : p.postedAt,
    dateOnly: p.dateOnly ?? false,
    references: p.references ?? [],
    inReplyTo: p.inReplyTo ?? null,
    isSpam: p.isSpam ?? false,
    recordId: p.recordId,
    sourceId: p.sourceId,
    externalId: p.externalId,
  }
}

const noop = (): void => {}

test('a crosspost (shared canonical id) unions two sources into one conversation', () => {
  const a = rec({ recordId: 'a', sourceId: 'usenet-rec-arts-animation', externalId: '<m1>' })
  const b = rec({ recordId: 'b', sourceId: 'usenet-alt-tv-familyguy', externalId: '<m1>' }) // same canonical
  const { conversations, summary } = buildConversations([a, b], noop)
  expect(conversations.length).toBe(1)
  const conv = conversations[0]
  expect(conv).toBeDefined()
  if (!conv) return
  expect(conv.members.length).toBe(1)
  const member = conv.members[0]
  expect(member).toBeDefined()
  // Primary is the earliest source in the fixed order (familyguy before animation).
  expect(member?.recordId).toBe('b')
  expect(member?.additionalRecordIds).toEqual(['a'])
  expect(conv.sources.length).toBe(2)
  expect(summary.crosspostMembers).toBe(1)
  expect(summary.crossSourceConversations).toBe(1)
})

test('a cross-source reference unions two per-source threads', () => {
  const parent = rec({ recordId: 'p', sourceId: 'usenet-alt-tv-familyguy', externalId: '<p1>', postedAt: '2006-01-01T00:00:00.000Z' })
  const child = rec({
    recordId: 'c',
    sourceId: 'usenet-rec-arts-tv',
    externalId: '<c1>',
    references: ['<p1>'],
    inReplyTo: '<p1>',
    postedAt: '2006-01-02T00:00:00.000Z',
  })
  const { conversations, summary } = buildConversations([parent, child], noop)
  expect(conversations.length).toBe(1)
  expect(summary.referenceUnions).toBe(1)
  const conv = conversations[0]
  if (!conv) return
  const byCanonical = new Map(conv.members.map((m) => [m.canonicalId, m]))
  const c = byCanonical.get(canon('<c1>'))
  expect(c?.parentCanonicalId).toBe(canon('<p1>'))
  expect(c?.depth).toBe(1)
  expect(byCanonical.get(canon('<p1>'))?.depth).toBe(0)
})

test('a shared subject never merges across sources', () => {
  const a = rec({ recordId: 'a', sourceId: 'usenet-alt-tv-familyguy', externalId: '<a1>', subjectNorm: 'same topic' })
  const b = rec({ recordId: 'b', sourceId: 'usenet-rec-arts-animation', externalId: '<b1>', subjectNorm: 'same topic' })
  const { conversations } = buildConversations([a, b], noop)
  expect(conversations.length).toBe(2)
})

test('a reference to a non-member id leaves the record a root', () => {
  const r = rec({ recordId: 'r', sourceId: 'usenet-alt-tv-familyguy', externalId: '<r1>', references: ['<gone>'] })
  const { conversations } = buildConversations([r], noop)
  expect(conversations.length).toBe(1)
  const member = conversations[0]?.members[0]
  expect(member?.parentCanonicalId).toBeNull()
  expect(member?.depth).toBe(0)
})

test('the conversation key is stable across input order', () => {
  const parent = rec({ recordId: 'p', sourceId: 'usenet-alt-tv-familyguy', externalId: '<p1>', postedAt: '2006-01-01T00:00:00.000Z' })
  const child = rec({
    recordId: 'c',
    sourceId: 'usenet-rec-arts-tv',
    externalId: '<c1>',
    references: ['<p1>'],
    postedAt: '2006-01-02T00:00:00.000Z',
  })
  const forward = buildConversations([parent, child], noop).conversations.map((c) => c.key)
  const reversed = buildConversations([child, parent], noop).conversations.map((c) => c.key)
  expect(forward).toEqual(reversed)
  expect(forward[0]).toMatch(/^c:[0-9a-f]{16}$/)
})

test('an all-undated thread is dropped and gets no conversation', () => {
  const r = rec({ recordId: 'u', sourceId: 'usenet-alt-tv-familyguy', externalId: '<u1>', postedAt: null })
  const { conversations, summary } = buildConversations([r], noop)
  expect(conversations.length).toBe(0)
  expect(summary.undatedRecords).toBe(1)
})
