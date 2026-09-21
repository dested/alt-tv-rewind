import { expect, test } from 'bun:test'
import { countLines, normalizeSubject, parseDate, parseFrom, parseMessageIdList } from './normalize'
import type { Headers } from './mime'

function dateHeaders(entries: Record<string, string>): Headers {
  const h: Headers = new Map()
  for (const [k, v] of Object.entries(entries)) h.set(k.toLowerCase(), [v])
  return h
}

test('normalizeSubject strips reply prefixes and tags', () => {
  expect(normalizeSubject('Re: Re: Kramer Speaks')).toEqual({ display: 'Kramer Speaks', norm: 'kramer speaks' })
  expect(normalizeSubject('RE: [2] foo')).toEqual({ display: 'foo', norm: 'foo' })
  expect(normalizeSubject('Fwd:  x')).toEqual({ display: 'x', norm: 'x' })
  expect(normalizeSubject('')).toEqual({ display: '(no subject)', norm: '' })
  expect(normalizeSubject('[alt.tv.seinfeld] The Contest')).toEqual({
    display: 'The Contest',
    norm: 'the contest',
  })
})

test('parseFrom handles all address forms and never returns the address as name', () => {
  const cases: Array<[string, string, string | null]> = [
    ['"Karl Farbmann" <k@hotmail.com>', 'Karl Farbmann', 'k@hotmail.com'],
    ['Karl Farbmann <k@hotmail.com>', 'Karl Farbmann', 'k@hotmail.com'],
    ['k@hotmail.com (Karl Farbmann)', 'Karl Farbmann', 'k@hotmail.com'],
    ['<k@hotmail.com>', 'k', 'k@hotmail.com'],
    ['k@hotmail.com', 'k', 'k@hotmail.com'],
  ]
  for (const [raw, name, email] of cases) {
    const parsed = parseFrom(raw)
    expect(parsed).toEqual({ name, email })
    expect(parsed.name.includes('@')).toBe(false)
  }
  const rfc = parseFrom('=?utf-8?Q?Jos=C3=A9?= <j@x.com>')
  expect(rfc).toEqual({ name: 'José', email: 'j@x.com' })
  expect(parseFrom('')).toEqual({ name: 'unknown', email: null })
})

const timed = (iso: string) => ({ iso, dateOnly: false })

test('parseDate: numeric offset', () => {
  expect(parseDate(dateHeaders({ Date: 'Mon, 27 Dec 2010 13:32:19 -0600' }))).toEqual(
    timed('2010-12-27T19:32:19.000Z')
  )
})

test('parseDate: named zone EST', () => {
  expect(parseDate(dateHeaders({ Date: 'Sat, 01 Jan 2005 12:00:00 EST' }))).toEqual(
    timed('2005-01-01T17:00:00.000Z')
  )
})

test('parseDate: strips a (PDT) comment', () => {
  expect(parseDate(dateHeaders({ Date: 'Tue, 10 Jun 2003 10:00:00 -0700 (PDT)' }))).toEqual(
    timed('2003-06-10T17:00:00.000Z')
  )
})

test('parseDate: 2-digit year', () => {
  expect(parseDate(dateHeaders({ Date: 'Fri, 01 Jan 99 12:00:00 GMT' }))).toEqual(
    timed('1999-01-01T12:00:00.000Z')
  )
})

test('parseDate: a time with no zone is UTC, never the machine zone', () => {
  expect(parseDate(dateHeaders({ Date: 'Mon, 27 Dec 2010 13:32:19' }))).toEqual(
    timed('2010-12-27T13:32:19.000Z')
  )
})

test('parseDate: date-only header → noon UTC, flagged', () => {
  expect(parseDate(dateHeaders({ Date: '1996/05/17' }))).toEqual({
    iso: '1996-05-17T12:00:00.000Z',
    dateOnly: true,
  })
  expect(parseDate(dateHeaders({ Date: '1996/05/17 ' }))?.dateOnly).toBe(true)
})

test('parseDate: date-only Date yields to a timed posting date on the same day', () => {
  expect(
    parseDate(
      dateHeaders({ Date: '2000/05/28', 'NNTP-Posting-Date': 'Sun, 28 May 2000 22:10:00 -0400' })
    )
  ).toEqual(timed('2000-05-29T02:10:00.000Z'))
  // …but not to one from a different week (a re-injection, not the post time)
  expect(
    parseDate(
      dateHeaders({ Date: '2000/05/28', 'NNTP-Posting-Date': 'Sun, 11 Jun 2000 22:10:00 -0400' })
    )
  ).toEqual({ iso: '2000-05-28T12:00:00.000Z', dateOnly: true })
})

test('parseDate: garbage and out-of-range return null, falls back to next header', () => {
  expect(parseDate(dateHeaders({ Date: 'not a date at all' }))).toBe(null)
  expect(parseDate(dateHeaders({ Date: 'Wed, 01 Jan 1975 00:00:00 GMT' }))).toBe(null)
  expect(
    parseDate(dateHeaders({ Date: 'garbage', 'NNTP-Posting-Date': 'Mon, 27 Dec 2010 13:32:19 -0600' }))
  ).toEqual(timed('2010-12-27T19:32:19.000Z'))
})

test('parseMessageIdList extracts and dedupes in order', () => {
  expect(parseMessageIdList('<a@x> <b@y> <a@x>')).toEqual(['<a@x>', '<b@y>'])
  expect(parseMessageIdList(null)).toEqual([])
})

test('countLines', () => {
  expect(countLines('')).toBe(0)
  expect(countLines('a')).toBe(1)
  expect(countLines('a\nb\nc')).toBe(3)
})
