// Field normalization: subjects, sender identity, dates, message-id lists.
import { decodeRfc2047, header, type Headers } from './mime'

export function normalizeSubject(s: string): { display: string; norm: string } {
  let display = decodeRfc2047(s).replace(/\s+/g, ' ').trim()
  const prefixRe = /^\s*((re|fw|fwd|aw|sv|antw)\s*(\[\d+\])?\s*:\s*)+/i
  const tagRe = /^\[[^\]]+\]\s*/
  let changed = true
  while (changed) {
    changed = false
    const afterPrefix = display.replace(prefixRe, '')
    if (afterPrefix !== display) {
      display = afterPrefix
      changed = true
    }
    const afterTag = display.replace(tagRe, '')
    if (afterTag !== display) {
      display = afterTag
      changed = true
    }
  }
  display = display.trim()
  if (display === '') return { display: '(no subject)', norm: '' }
  const norm = display
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
  return { display, norm }
}

export function parseFrom(raw: string): { name: string; email: string | null } {
  const s = decodeRfc2047(raw).trim()
  if (s === '') return { name: 'unknown', email: null }

  let name = ''
  let email: string | null = null

  const angle = s.match(/<([^>]*)>/)
  if (angle && angle[1] !== undefined) {
    const idx = angle.index ?? 0
    email = angle[1].trim() || null
    name = (s.slice(0, idx) + s.slice(idx + angle[0].length)).trim()
  } else {
    const paren = s.match(/^(\S+)\s*\(([^)]*)\)\s*$/)
    if (paren && paren[1] !== undefined && paren[2] !== undefined) {
      email = paren[1].trim()
      name = paren[2].trim()
    } else if (/@/.test(s) && !/\s/.test(s)) {
      email = s
    } else {
      name = s
    }
  }

  name = name
    .replace(/^["']+|["']+$/g, '')
    .replace(/\\(.)/g, '$1')
    .replace(/^["']+|["']+$/g, '')
    .trim()

  if (email !== null && !/@/.test(email)) email = null

  if (name === '' || /@/.test(name)) {
    if (email !== null) {
      const local = email.split('@')[0]
      name = local !== undefined && local !== '' ? local : 'unknown'
    } else {
      name = 'unknown'
    }
  }
  return { name, email }
}

export function posterKey(email: string | null, name: string): string {
  const input = email !== null ? email.toLowerCase().trim() : 'n:' + name.toLowerCase().trim()
  return new Bun.CryptoHasher('sha256').update(input).digest('hex').slice(0, 16)
}

const ZONES: Record<string, number> = {
  UT: 0,
  UTC: 0,
  GMT: 0,
  Z: 0,
  EST: -5,
  EDT: -4,
  CST: -6,
  CDT: -5,
  MST: -7,
  MDT: -6,
  PST: -8,
  PDT: -7,
  CET: 1,
  CEST: 2,
  BST: 1,
  MET: 1,
  MEST: 2,
  EET: 2,
  JST: 9,
  AEST: 10,
  AEDT: 11,
}
const MONTHS: Record<string, number> = {
  jan: 0,
  feb: 1,
  mar: 2,
  apr: 3,
  may: 4,
  jun: 5,
  jul: 6,
  aug: 7,
  sep: 8,
  oct: 9,
  nov: 10,
  dec: 11,
}
const MIN_MS = Date.UTC(1980, 0, 1)
const MAX_MS = Date.UTC(2030, 0, 1)

function tryParseDateString(raw: string): string | null {
  const cleaned = raw
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (cleaned === '') return null
  let ms = Date.parse(cleaned)
  if (Number.isNaN(ms)) {
    const m = cleaned.match(
      /^(?:[A-Za-z]{3},?\s*)?(\d{1,2})\s+([A-Za-z]{3})\.?\s+(\d{2,4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([+-]\d{4}|[A-Z]{1,5})?/
    )
    if (!m) return null
    const dayS = m[1]
    const monS = m[2]
    const yearS = m[3]
    const hourS = m[4]
    const minS = m[5]
    if (
      dayS === undefined ||
      monS === undefined ||
      yearS === undefined ||
      hourS === undefined ||
      minS === undefined
    )
      return null
    const mon = MONTHS[monS.toLowerCase()]
    if (mon === undefined) return null
    const day = parseInt(dayS, 10)
    let year = parseInt(yearS, 10)
    if (yearS.length <= 2) year = year < 70 ? 2000 + year : 1900 + year
    const hour = parseInt(hourS, 10)
    const min = parseInt(minS, 10)
    const sec = m[6] !== undefined ? parseInt(m[6], 10) : 0
    const zoneRaw = m[7]
    let offsetMin = 0
    if (zoneRaw !== undefined) {
      if (/^[+-]\d{4}$/.test(zoneRaw)) {
        const sign = zoneRaw.startsWith('-') ? -1 : 1
        offsetMin = sign * (parseInt(zoneRaw.slice(1, 3), 10) * 60 + parseInt(zoneRaw.slice(3, 5), 10))
      } else {
        const z = ZONES[zoneRaw.toUpperCase()]
        offsetMin = z === undefined ? 0 : z * 60
      }
    }
    ms = Date.UTC(year, mon, day, hour, min, sec) - offsetMin * 60000
  }
  if (Number.isNaN(ms) || ms < MIN_MS || ms >= MAX_MS) return null
  return new Date(ms).toISOString()
}

export function parseDate(h: Headers): string | null {
  for (const name of ['date', 'nntp-posting-date', 'injection-date']) {
    const raw = header(h, name)
    if (raw === null) continue
    const iso = tryParseDateString(raw)
    if (iso !== null) return iso
  }
  return null
}

export function parseMessageIdList(s: string | null): string[] {
  if (s === null) return []
  const ids: string[] = []
  const seen = new Set<string>()
  const re = /<[^<>]+>/g
  let m: RegExpExecArray | null
  while ((m = re.exec(s)) !== null) {
    const id = m[0]
    if (!seen.has(id)) {
      seen.add(id)
      ids.push(id)
    }
  }
  return ids
}

export function countLines(body: string): number {
  if (body === '') return 0
  return body.split('\n').length
}
