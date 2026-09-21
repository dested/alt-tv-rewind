import { expect, test } from 'bun:test'
import { detectSpam } from './spam'

const clean = { subject: 'hello', body: '', newsgroups: ['alt.tv.seinfeld'], postedAt: null }

test('crosspost', () => {
  expect(detectSpam({ ...clean, newsgroups: ['a', 'b', 'c', 'd', 'e', 'f', 'g'] })).toBe('crosspost')
})

test('urls', () => {
  const body = 'http://a http://b http://c http://d http://e http://f http://g http://h'
  expect(detectSpam({ ...clean, body })).toBe('urls')
})

test('subject-keyword', () => {
  expect(detectSpam({ ...clean, subject: 'Buy Viagra now' })).toBe('subject-keyword')
})

test('body-keywords', () => {
  expect(detectSpam({ ...clean, body: 'get viagra and cialis cheap' })).toBe('body-keywords')
})

test('shouting', () => {
  expect(
    detectSpam({
      ...clean,
      subject: 'THIS IS A HUGE ANNOUNCEMENT',
      postedAt: '2005-01-01T00:00:00.000Z',
    })
  ).toBe('shouting')
})

test('legit 1996 all-caps subject is not flagged', () => {
  expect(
    detectSpam({
      ...clean,
      subject: 'SEINFELD SERIES FINALE TONIGHT',
      postedAt: '1996-05-14T00:00:00.000Z',
    })
  ).toBe(null)
})
