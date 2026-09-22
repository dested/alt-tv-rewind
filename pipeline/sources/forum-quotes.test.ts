import { describe, expect, test } from 'bun:test'
import { forumBodyToUsenet } from './forum-quotes'

describe('forumBodyToUsenet', () => {
  test('named quote becomes a "Name wrote:" attribution + quoted lines', () => {
    expect(forumBodyToUsenet('I agree.\n\n[quote="Bob"]This is great[/quote]\n\nMe too.')).toBe(
      'I agree.\n\nBob wrote:\n> This is great\n\nMe too.'
    )
  })

  test('unnamed quote just prefixes the inner lines', () => {
    expect(forumBodyToUsenet('[quote]original text[/quote]\nreply here')).toBe('> original text\nreply here')
  })

  test('nested quotes add one level of "> " per depth', () => {
    expect(
      forumBodyToUsenet('[quote="Alice"]outer\n[quote="Bob"]inner line[/quote]\nback to outer[/quote]\ntop')
    ).toBe('Alice wrote:\n> outer\n> Bob wrote:\n> > inner line\n> back to outer\ntop')
  })

  test('[quote=Name] without quotes and case-insensitive tags are handled', () => {
    expect(forumBodyToUsenet('[quote=Bob]hi there[/quote]')).toBe('Bob wrote:\n> hi there')
    expect(forumBodyToUsenet('[QUOTE="Kim"]shouted[/QUOTE]')).toBe('Kim wrote:\n> shouted')
  })

  test('blank lines inside a quote stay quoted', () => {
    expect(forumBodyToUsenet('[quote="Sam"]line one\nline two\n\nline four[/quote]')).toBe(
      'Sam wrote:\n> line one\n> line two\n>\n> line four'
    )
  })

  test('unbalanced markers are dropped, surrounding text kept', () => {
    expect(forumBodyToUsenet('hello [/quote] world')).toBe('hello \n world')
    expect(forumBodyToUsenet('[quote="X"]dangling text with no close')).toBe(
      'X wrote:\n> dangling text with no close'
    )
  })

  test('smilies and other markup pass through verbatim', () => {
    expect(forumBodyToUsenet('lol :lol: nice [quote="Z"]:cool: yep[/quote]')).toBe(
      'lol :lol: nice \nZ wrote:\n> :cool: yep'
    )
  })

  test('a post with no quotes is unchanged', () => {
    expect(forumBodyToUsenet('just a plain reply\nwith two lines')).toBe('just a plain reply\nwith two lines')
  })
})
