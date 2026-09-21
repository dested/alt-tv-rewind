import { expect, test } from 'bun:test'
import { type Block, initials, parseMessage, posterHue, redact, stripRe } from './usenet'

function only(blocks: Block[], type: Block['type']): Block[] {
  return blocks.filter((b) => b.type === type)
}

test('unwraps hard-wrapped lines into one paragraph', () => {
  const blocks = parseMessage('This was the best\nepisode of the\nwhole season.')
  expect(blocks).toEqual([
    { type: 'paragraph', text: 'This was the best episode of the whole season.' },
  ])
})

test('quote carries the parenthesised attribution and consumes its intro line', () => {
  const body = [
    'In article <abc123@news.example.com> foo@bar.com (Mark Collins) writes:',
    '> Kramer was robbed.',
    '',
    'Totally agree.',
  ].join('\n')
  const blocks = parseMessage(body)
  const quotes = only(blocks, 'quote')
  expect(quotes.length).toBe(1)
  const quote = quotes[0]!
  if (quote.type !== 'quote') throw new Error('expected quote')
  expect(quote.attribution).toBe('Mark Collins')
  expect(quote.depth).toBe(1)
  // the attribution line is consumed, not rendered as a paragraph
  const paras = only(blocks, 'paragraph')
  expect(paras).toEqual([{ type: 'paragraph', text: 'Totally agree.' }])
  const inner = quote.blocks.find((b) => b.type === 'paragraph')
  expect(inner).toEqual({ type: 'paragraph', text: 'Kramer was robbed.' })
})

test('nested >> quote becomes a depth-2 quote block', () => {
  const body = ['> He said:', '>> Original point here.', '> Reply to it.'].join('\n')
  const blocks = parseMessage(body)
  const outer = blocks.find((b) => b.type === 'quote')
  if (!outer || outer.type !== 'quote') throw new Error('expected outer quote')
  expect(outer.depth).toBe(1)
  const nested = outer.blocks.find((b) => b.type === 'quote')
  if (!nested || nested.type !== 'quote') throw new Error('expected nested quote')
  expect(nested.depth).toBe(2)
})

test('-- signature drops rule lines and redacts the email', () => {
  const body = [
    'The finale was fine.',
    '',
    '-- ',
    'Mark Collins',
    'mark@example.com',
    '********************',
  ].join('\n')
  const blocks = parseMessage(body)
  const sig = blocks.find((b) => b.type === 'signature')
  if (!sig || sig.type !== 'signature') throw new Error('expected signature')
  expect(sig.lines).toEqual(['Mark Collins', '[email]'])
  expect(sig.lines.some((l) => l.includes('*'))).toBe(false)
})

test('heuristic signature: trailing block with an email and no -- delimiter', () => {
  const body = ['Great episode.', '', 'Cheers,', 'Jerry Seinfeld', 'jerry@nbc.example.com'].join(
    '\n'
  )
  const blocks = parseMessage(body)
  const sig = blocks.find((b) => b.type === 'signature')
  if (!sig || sig.type !== 'signature') throw new Error('expected heuristic signature')
  expect(sig.lines).toEqual(['Cheers,', 'Jerry Seinfeld', '[email]'])
  // the body proper is a single paragraph, not swallowed by the signature
  expect(only(blocks, 'paragraph')).toEqual([{ type: 'paragraph', text: 'Great episode.' }])
})

test('detects a preformatted ASCII table', () => {
  const body = ['Rank   Name      Votes', '1      Kramer    50', '2      Newman    12'].join('\n')
  const blocks = parseMessage(body)
  const pre = blocks.find((b) => b.type === 'pre')
  if (!pre || pre.type !== 'pre') throw new Error('expected pre')
  expect(pre.text).toContain('Rank   Name      Votes')
})

test('detects a bulleted list with continuation lines', () => {
  const body = [
    '- first point',
    '- second point that keeps',
    '  going onto another line',
    '- third',
  ].join('\n')
  const blocks = parseMessage(body)
  const list = blocks.find((b) => b.type === 'list')
  if (!list || list.type !== 'list') throw new Error('expected list')
  expect(list.items).toEqual([
    'first point',
    'second point that keeps going onto another line',
    'third',
  ])
})

test('redact handles emails, bang paths and message-ids', () => {
  expect(redact('reach me at foo@bar.com')).toBe('reach me at [email]')
  expect(redact('uunet!sequent!lauto!markco')).toBe('[address]')
  expect(redact('see <msg1@host.net> for context')).toBe('see for context')
})

test('stripRe strips stacked reply prefixes', () => {
  expect(stripRe('Re: Re: Kramer')).toBe('Kramer')
  expect(stripRe('Fwd: The Contest')).toBe('The Contest')
  expect(stripRe('No prefix here')).toBe('No prefix here')
})

test('initials takes the first letters of the first two words', () => {
  expect(initials('Mark Collins')).toBe('MC')
  expect(initials('markco')).toBe('M')
  expect(initials('  ')).toBe('?')
  expect(initials('a b c d')).toBe('AB')
})

test('posterHue is deterministic and in range', () => {
  expect(posterHue('Mark Collins')).toBe(posterHue('Mark Collins'))
  expect(posterHue('Mark Collins')).toBe(posterHue('MARK COLLINS'))
  for (const name of ['a', 'Kramer', 'Newman', 'Jerry Seinfeld', '']) {
    const hue = posterHue(name)
    expect(hue).toBeGreaterThanOrEqual(0)
    expect(hue).toBeLessThan(360)
    expect(Number.isInteger(hue)).toBe(true)
  }
})

test('empty body yields no blocks', () => {
  expect(parseMessage('')).toEqual([])
})

test('deep quotes flatten at depth 3', () => {
  const body = ['> a', '>> b', '>>> c', '>>>> d'].join('\n')
  const blocks = parseMessage(body)
  function maxDepth(bs: Block[]): number {
    let max = 0
    for (const b of bs) {
      if (b.type === 'quote') max = Math.max(max, b.depth, maxDepth(b.blocks))
    }
    return max
  }
  expect(maxDepth(blocks)).toBe(3)
})
