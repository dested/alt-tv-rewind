import { describe, expect, test } from 'bun:test'
import {
  chooseThread,
  mapDates,
  memberFate,
  projectThread,
  threadRelation,
  type LegacyMessage,
  type ProjectionMember,
} from './projection'

function legacy(rows: Array<Partial<LegacyMessage> & { messageId: string; threadId: number }>): Map<string, LegacyMessage> {
  const m = new Map<string, LegacyMessage>()
  let id = 1
  for (const r of rows) {
    m.set(r.messageId, {
      id: r.id ?? id++,
      messageId: r.messageId,
      threadId: r.threadId,
      depth: r.depth ?? 0,
      sourceRecordId: r.sourceRecordId ?? null,
    })
  }
  return m
}

describe('chooseThread', () => {
  test('picks the thread with the most legacy hits', () => {
    const idx = legacy([
      { messageId: '<a>', threadId: 10 },
      { messageId: '<b>', threadId: 10 },
      { messageId: '<c>', threadId: 20 },
    ])
    expect(chooseThread(['<a>', '<b>', '<c>', '<missing>'], idx)).toBe(10)
  })

  test('breaks ties on the lowest thread id', () => {
    const idx = legacy([
      { messageId: '<a>', threadId: 30 },
      { messageId: '<b>', threadId: 12 },
    ])
    expect(chooseThread(['<a>', '<b>'], idx)).toBe(12)
  })

  test('returns null when no member is in the legacy index', () => {
    expect(chooseThread(['<x>', '<y>'], legacy([{ messageId: '<a>', threadId: 1 }]))).toBeNull()
  })
})

describe('memberFate', () => {
  const idx = legacy([
    { messageId: '<legacy>', threadId: 1, sourceRecordId: null },
    { messageId: '<mine>', threadId: 1, sourceRecordId: 777 },
    { messageId: '<other-import>', threadId: 1, sourceRecordId: 999 },
  ])
  test('a Message-ID absent from the index is inserted', () => {
    expect(memberFate('<new>', 777, idx)).toBe('insert')
  })
  test('a plain legacy row is linked, never inserted', () => {
    expect(memberFate('<legacy>', 777, idx)).toBe('linked')
  })
  test('a row this record already produced is alreadyImported (idempotent re-run)', () => {
    expect(memberFate('<mine>', 777, idx)).toBe('alreadyImported')
  })
  test('a prior-import row for a different record is linked, not re-inserted', () => {
    expect(memberFate('<other-import>', 777, idx)).toBe('linked')
  })
})

describe('mapDates', () => {
  test('a day-precision record is date-only and keeps day precision', () => {
    expect(mapDates('day', false)).toEqual({ dateOnly: true, datePrecision: 'day' })
  })
  test('an inherited date is date-only and downgraded to unknown', () => {
    expect(mapDates('second', true)).toEqual({ dateOnly: true, datePrecision: 'unknown' })
  })
  test('a real second-precision record keeps its clock', () => {
    expect(mapDates('second', false)).toEqual({ dateOnly: false, datePrecision: 'second' })
  })
})

describe('projectThread', () => {
  function member(externalId: string, parentCanonicalId: string | null, references: string[] = []): ProjectionMember {
    return { externalId, canonicalId: `canon:${externalId}`, parentCanonicalId, references }
  }

  test('a member whose parent is another member gets that member as parent, depth + 1', () => {
    const root = member('<root>', null)
    const reply = member('<reply>', 'canon:<root>')
    const byCanon = new Map([
      ['canon:<root>', '<root>'],
      ['canon:<reply>', '<reply>'],
    ])
    const out = projectThread([root, reply], byCanon, new Map())
    expect(out.get('<root>')).toEqual({ parentRef: null, depth: 0 })
    expect(out.get('<reply>')).toEqual({ parentRef: '<root>', depth: 1 })
  })

  test('a member with no conversation parent falls back to a legacy reference', () => {
    const reply = member('<reply>', null, ['<legacy-root>', '<legacy-mid>'])
    const legacyDepth = new Map([
      ['<legacy-root>', 0],
      ['<legacy-mid>', 2],
    ])
    const out = projectThread([reply], new Map([['canon:<reply>', '<reply>']]), legacyDepth)
    // newest matching reference wins → the depth-2 legacy row → depth 3
    expect(out.get('<reply>')).toEqual({ parentRef: '<legacy-mid>', depth: 3 })
  })

  test('a member with neither a conversation parent nor a legacy reference is a root', () => {
    const orphan = member('<orphan>', null, ['<unknown>'])
    const out = projectThread([orphan], new Map([['canon:<orphan>', '<orphan>']]), new Map())
    expect(out.get('<orphan>')).toEqual({ parentRef: null, depth: 0 })
  })

  test('a two-level member chain resolves depth through inserted members', () => {
    const root = member('<r>', null)
    const mid = member('<m>', 'canon:<r>')
    const leaf = member('<l>', 'canon:<m>')
    const byCanon = new Map([
      ['canon:<r>', '<r>'],
      ['canon:<m>', '<m>'],
      ['canon:<l>', '<l>'],
    ])
    const out = projectThread([root, mid, leaf], byCanon, new Map())
    expect(out.get('<l>')).toEqual({ parentRef: '<m>', depth: 2 })
  })
})

describe('threadRelation', () => {
  const airMs = Date.parse('2005-11-30T00:00:00Z')
  test('a post just after midnight ET the night of airing is day +0 → live', () => {
    // 2005-12-01T03:00Z is 2005-11-30 22:00 ET — the same ET day as the air date.
    expect(threadRelation(airMs, Date.parse('2005-12-01T03:00:00Z'), 10)).toBe('live')
  })
  test('a post well past the live window is retro', () => {
    expect(threadRelation(airMs, Date.parse('2006-03-01T12:00:00Z'), 10)).toBe('retro')
  })
})
