import { afterAll, expect, test } from 'bun:test'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { posterKey } from '../lib/normalize'
import { closeRawFiles, readRawFrom } from './raw-from'

const dir = mkdtempSync(join(tmpdir(), 'raw-from-'))
afterAll(() => closeRawFiles())

// Two mbox messages back to back, each opened by a `From <n>` separator line
// like a Google Groups export writes. The From: header carries the identity.
const first =
  'From 8858658583204635456\n' +
  'From: "Jane Doe" <jane@example.com>\n' +
  'Subject: Hi there\n' +
  '\n' +
  "It's a body.\n"
const second =
  'From -4780430503708643449\n' +
  'From: bob@example.net (Bob Smith)\n' +
  'Subject: Reply\n' +
  '\n' +
  'Second body.\n'
const noFrom = 'From 1\n' + 'Subject: Anonymous\n' + '\n' + 'No sender here.\n'

test('reads the display name and a 16-hex poster key from the raw From line', () => {
  const path = join(dir, 'a.mbox')
  writeFileSync(path, first)
  const out = readRawFrom(path, 0, Buffer.byteLength(first))
  expect(out.name).toBe('Jane Doe')
  expect(out.posterKey).toMatch(/^[0-9a-f]{16}$/)
  expect(out.posterKey).toBe(posterKey('jane@example.com', 'Jane Doe'))
})

test('reads a message at a byte offset inside the file', () => {
  const path = join(dir, 'b.mbox')
  const buf = first + second
  writeFileSync(path, buf)
  const offset = Buffer.byteLength(first)
  const out = readRawFrom(path, offset, Buffer.byteLength(second))
  expect(out.name).toBe('Bob Smith')
  expect(out.posterKey).toBe(posterKey('bob@example.net', 'Bob Smith'))
})

test('falls back to an unknown identity when the From header is missing', () => {
  const path = join(dir, 'c.mbox')
  writeFileSync(path, noFrom)
  const out = readRawFrom(path, 0, Buffer.byteLength(noFrom))
  expect(out.name).toBe('unknown')
  expect(out.posterKey).toMatch(/^[0-9a-f]{16}$/)
  expect(out.posterKey).toBe(posterKey(null, 'unknown'))
})
