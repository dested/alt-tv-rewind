import { describe, expect, test } from 'bun:test'
import { extractContributions, type ContributionKind } from './capsule-extract'

// Inline fixtures modeled on the three real capsule layouts; no corpus files.
const CHERRY = [
  '[9F99] Test Episode',
  '',
  'Test Episode                          Written by Someone',
  '',
  'Did you notice...',
  '',
  'Ann Observer:',
  '    ... the thing on the wall?',
  '    ... the other thing?',
  '',
  'Reviews',
  '',
  'Jane Smith: A wonderful episode with great jokes and a strong ending that',
  '    really tied the season together.  I give it an A.',
  '',
  'Bob Jones: Not my favorite.  The pacing dragged in the middle and the',
  '    third act felt rushed.  C+.',
  '',
  'Meh.',
  '',
  'Comments and other observations',
  '',
  'Carl Writer notes, "The sign in the background is a reference to an old',
  '    film."',
  '',
  'Average grade: B- (2.9)   (7 reviews)',
  '',
  'Quotes and Scene Summary',
  '',
  'Homer and Marge sit at the kitchen table discussing their day.',
  '',
  'Homer: I had a great day.',
  'Marge: That is nice, Homer.',
  'Homer: The best day ever.',
  '',
  'Contributors',
  '',
  'Thanks to everyone {js} who helped.',
].join('\n')

const ROBINSON = [
  '[EABF01] Robinson Test',
  '',
  '==============================',
  '> Reviews',
  '==============================',
  '',
  'Don Del Grande: A solid outing with a few weak spots.  Overall a good time.  (B)',
  '',
  'AVERAGE GRADE:  B (3.0)   (5 reviews computed)',
  '',
  '==============================',
  '> Comments and other observations',
  '==============================',
  '',
  '>> Musical Reference',
  '',
  'Joe Green:  "Song Title" plays during the chase scene.',
  '',
  '>> Another Note',
  '',
  'Tony Hill:  This is a reference to a 1980s show.',
  '',
  '>> Third Note',
  '',
  'Ken Adams:  A third observation about the episode.',
  '',
  '==============================',
  '> Quotes and Scene Summary',
  '==============================',
  '',
  'The family gathers in the living room.',
  '',
  'Bart: Ay caramba!',
  'Lisa: Bart, stop it.',
  'Bart: Never!',
  '',
].join('\n')

// The later plain-text capsules mark headings with ">Heading" (no space) and no
// ">>" subsections; they are still robinson.
const ROBINSON_NOSPACE = [
  '[4F24] No Space Test',
  '',
  '>Reviews',
  '',
  'Chris Courtois: A strong episode with real heart.  I give it an A-.',
  '',
  '>Comments and other observations',
  '',
  'Andrew Gill:  The billboard gag is a callback to season three.',
  '',
  '>Did You Notice...',
  '',
  'Don Del Grande:',
  '    ... the license plate?',
  '    ... the clock on the wall?',
  '',
].join('\n')

const CHEN = [
  'Some Episode',
  '',
  'Just a big block of text with no headings at all.',
  '',
  'More text describing the show.',
  '',
  'HTML conversion by A. Person, 10 Sept 1994',
].join('\n')

const UNRECOGNIZED = 'A short note.\n\nNothing structured here at all.\n'

const kindsOf = (b: string): ContributionKind[] => extractContributions(b).contributions.map((c) => c.kind)

describe('extractContributions — cherry', () => {
  const { layout, contributions } = extractContributions(CHERRY)

  test('detects the cherry layout', () => {
    expect(layout).toBe('cherry')
  })

  test('review section yields one review per attributed paragraph', () => {
    const reviews = contributions.filter((c) => c.kind === 'review')
    expect(reviews.map((r) => r.attribution)).toEqual(['Jane Smith', 'Bob Jones'])
  })

  test('a short unattributed line in a review section is dropped', () => {
    expect(contributions.some((c) => c.text === 'Meh.')).toBe(false)
  })

  test('a "Did you notice..." block is an attributed observation', () => {
    const obs = contributions.find((c) => c.section === 'Did you notice...')
    expect(obs?.kind).toBe('observation')
    expect(obs?.attribution).toBe('Ann Observer')
  })

  test('an "Average grade" line is a grade, never a review', () => {
    const grade = contributions.find((c) => c.text.startsWith('Average grade'))
    expect(grade?.kind).toBe('grade')
  })

  test('the quotes section splits into prose summary and script-form quote', () => {
    const quotes = contributions.filter((c) => c.section === 'Quotes and Scene Summary')
    expect(quotes.map((q) => q.kind)).toEqual(['summary', 'quote'])
  })

  test('spans point back into the exact body', () => {
    const jane = contributions.find((c) => c.attribution === 'Jane Smith')
    expect(jane).toBeDefined()
    if (jane) expect(CHERRY.slice(jane.spanStart, jane.spanEnd).trim()).toBe(jane.text)
  })

  test('no quote/summary/grade paragraph is ever a review', () => {
    for (const c of contributions) if (c.kind !== 'review') expect(c.kind).not.toBe('review')
  })
})

describe('extractContributions — robinson', () => {
  const { layout, contributions } = extractContributions(ROBINSON)

  test('detects the robinson layout', () => {
    expect(layout).toBe('robinson')
  })

  test('review and average-grade share the Reviews section but keep distinct kinds', () => {
    const inReviews = contributions.filter((c) => c.section === 'Reviews')
    expect(inReviews.map((c) => c.kind)).toEqual(['review', 'grade'])
  })

  test('subsections under Comments are observations, attributed by leading name', () => {
    const obs = contributions.filter((c) => c.kind === 'observation')
    expect(obs.map((c) => c.attribution)).toEqual(['Joe Green', 'Tony Hill', 'Ken Adams'])
    expect(obs.map((c) => c.section)).toEqual(['Musical Reference', 'Another Note', 'Third Note'])
  })

  test('the quotes section yields a prose summary and a script-form quote', () => {
    const q = contributions.filter((c) => c.section === 'Quotes and Scene Summary')
    expect(q.map((c) => c.kind)).toEqual(['summary', 'quote'])
  })
})

describe('extractContributions — robinson with no-space headings', () => {
  const { layout, contributions } = extractContributions(ROBINSON_NOSPACE)

  test('">Heading" (no space) is recognized as robinson', () => {
    expect(layout).toBe('robinson')
  })

  test('sections and kinds resolve from the no-space headings', () => {
    expect(contributions.map((c) => [c.section, c.kind, c.attribution])).toEqual([
      ['Reviews', 'review', 'Chris Courtois'],
      ['Comments and other observations', 'observation', 'Andrew Gill'],
      ['Did You Notice...', 'observation', 'Don Del Grande'],
    ])
  })
})

describe('extractContributions — chen and unrecognized', () => {
  test('a headingless capsule with a conversion notice is chen, with no contributions', () => {
    const { layout, contributions } = extractContributions(CHEN)
    expect(layout).toBe('chen')
    expect(contributions).toEqual([])
  })

  test('an unstructured document is unrecognized, with no contributions', () => {
    const { layout } = extractContributions(UNRECOGNIZED)
    expect(layout).toBe('unrecognized')
    expect(kindsOf(UNRECOGNIZED)).toEqual([])
  })
})
