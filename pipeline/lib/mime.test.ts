import { expect, test } from 'bun:test'
import {
  decodeBody,
  decodeRfc2047,
  header,
  parseHeaders,
  splitMessage,
  type Headers,
} from './mime'

function latin1Bytes(s: string): Uint8Array {
  const out = new Uint8Array(s.length)
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xff
  return out
}

function headers(entries: Record<string, string>): Headers {
  const h: Headers = new Map()
  for (const [k, v] of Object.entries(entries)) h.set(k.toLowerCase(), [v])
  return h
}

test('quoted-printable soft breaks and =E9 in iso-8859-1', () => {
  const body = latin1Bytes('caf=E9 au=\r\nlait')
  const h = headers({ 'Content-Type': 'text/plain; charset="iso-8859-1"', 'Content-Transfer-Encoding': 'quoted-printable' })
  expect(decodeBody(body, h)).toBe('café aulait')
})

test('base64 utf-8 body', () => {
  const b64 = Buffer.from('café ☕', 'utf8').toString('base64')
  const h = headers({ 'Content-Type': 'text/plain; charset=utf-8', 'Content-Transfer-Encoding': 'base64' })
  expect(decodeBody(latin1Bytes(b64), h)).toBe('café ☕')
})

test('rfc2047 B and Q words', () => {
  const b = Buffer.from('Héllo', 'utf8').toString('base64')
  expect(decodeRfc2047(`=?utf-8?B?${b}?=`)).toBe('Héllo')
  expect(decodeRfc2047('=?iso-8859-1?Q?caf=E9?=')).toBe('café')
  expect(decodeRfc2047('=?utf-8?Q?foo=5Fbar?=')).toBe('foo_bar')
})

test('rfc2047 adjacent-word whitespace is dropped', () => {
  expect(decodeRfc2047('=?utf-8?Q?a?= =?utf-8?Q?b?=')).toBe('ab')
  expect(decodeRfc2047('=?utf-8?Q?a?= plain')).toBe('a plain')
  expect(decodeRfc2047('plain text')).toBe('plain text')
})

test('multipart/alternative picks text/plain even when html is first', () => {
  const raw = ['--BOUND', 'Content-Type: text/html', '', '<b>ignored</b>', '--BOUND', 'Content-Type: text/plain', '', 'chosen', '--BOUND--', ''].join('\r\n')
  const h = headers({ 'Content-Type': 'multipart/alternative; boundary="BOUND"' })
  expect(decodeBody(latin1Bytes(raw), h)).toBe('chosen')
})

test('html-only fallback strips tags and decodes entities', () => {
  const h = headers({ 'Content-Type': 'text/html' })
  const decoded = decodeBody(latin1Bytes('<p>Hi</p><br>there&amp;<a href="x">link</a>'), h)
  expect(decoded.trim()).toBe('Hi\n\nthere&link')
  expect(decoded.includes('<')).toBe(false)
})

test('unknown charset label falls back without throwing', () => {
  const h = headers({ 'Content-Type': 'text/plain; charset=x-weird-nonexistent' })
  expect(decodeBody(latin1Bytes('hello'), h)).toBe('hello')
})

test('folded header unfolds continuation lines', () => {
  const { headerBytes } = splitMessage(latin1Bytes('Subject: one\r\n two\r\nFrom: me\r\n\r\nbody'))
  const h = parseHeaders(headerBytes)
  expect(header(h, 'subject')).toBe('one two')
  expect(header(h, 'from')).toBe('me')
})

test('splitMessage separates headers and body at the blank line', () => {
  const { headerBytes, bodyBytes } = splitMessage(latin1Bytes('A: 1\r\n\r\nhello world'))
  expect(header(parseHeaders(headerBytes), 'a')).toBe('1')
  expect(new TextDecoder().decode(bodyBytes)).toBe('hello world')
})
