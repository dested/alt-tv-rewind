// MIME decoding for Usenet/mail messages: header parsing, RFC 2047 encoded
// words, multipart traversal, transfer-encoding and charset decoding. Tolerant
// by design — these are 20 years of real-world posts from dozens of clients.

export type Headers = Map<string, string[]>

const NL = 0x0a
const CR = 0x0d
const WINDOWS_1252 = 'windows-1252'

export function splitMessage(bytes: Uint8Array): { headerBytes: Uint8Array; bodyBytes: Uint8Array } {
  for (let i = 0; i < bytes.length; i++) {
    if (bytes[i] !== NL) continue
    if (bytes[i + 1] === NL) return { headerBytes: bytes.slice(0, i), bodyBytes: bytes.slice(i + 2) }
    if (bytes[i + 1] === CR && bytes[i + 2] === NL)
      return { headerBytes: bytes.slice(0, i), bodyBytes: bytes.slice(i + 3) }
  }
  return { headerBytes: bytes, bodyBytes: new Uint8Array(0) }
}

export function parseHeaders(headerBytes: Uint8Array): Headers {
  const text = new TextDecoder('latin1').decode(headerBytes)
  const lines: string[] = []
  for (let raw of text.split('\n')) {
    if (raw.endsWith('\r')) raw = raw.slice(0, -1)
    if (raw === '') continue
    const last = lines[lines.length - 1]
    if ((raw.startsWith(' ') || raw.startsWith('\t')) && last !== undefined) {
      lines[lines.length - 1] = last + ' ' + raw.trim() // unfold continuation
    } else {
      lines.push(raw)
    }
  }
  const h: Headers = new Map()
  for (const line of lines) {
    const idx = line.indexOf(':')
    if (idx === -1) continue
    const name = line.slice(0, idx).trim().toLowerCase()
    const value = line.slice(idx + 1).trim()
    const existing = h.get(name)
    if (existing) existing.push(value)
    else h.set(name, [value])
  }
  return h
}

export function header(h: Headers, name: string): string | null {
  const v = h.get(name.toLowerCase())
  if (v === undefined || v.length === 0) return null
  const first = v[0]
  return first === undefined ? null : first.trim()
}

// ───────────────────────── charset ─────────────────────────

export function decodeBytes(bytes: Uint8Array, charsetLabel: string): string {
  const label = charsetLabel.trim().toLowerCase()
  const aliased =
    label === '' ||
    label === 'us-ascii' ||
    label === 'ascii' ||
    label === 'iso-8859-1' ||
    label === 'latin1' ||
    label === 'x-unknown' ||
    label === 'unknown-8bit' ||
    label === 'default'
      ? WINDOWS_1252
      : label
  try {
    return new TextDecoder(aliased, { fatal: aliased === 'utf-8' }).decode(bytes)
  } catch (e) {
    if (e instanceof RangeError || e instanceof TypeError) {
      return new TextDecoder(WINDOWS_1252).decode(bytes)
    }
    throw e
  }
}

function bytesToLatin1(bytes: Uint8Array): string {
  return new TextDecoder('latin1').decode(bytes)
}

function latin1ToBytes(s: string): Uint8Array {
  const out = new Uint8Array(s.length)
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xff
  return out
}

// ───────────────────────── RFC 2047 encoded words ─────────────────────────

function base64ToBytes(text: string): Uint8Array {
  return new Uint8Array(Buffer.from(text.replace(/\s+/g, ''), 'base64'))
}

function qDecodeToBytes(text: string): Uint8Array {
  const out: number[] = []
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (c === undefined) break
    if (c === '_') {
      out.push(0x20)
    } else if (c === '=' && i + 2 < text.length) {
      const hex = text.slice(i + 1, i + 3)
      if (/^[0-9a-fA-F]{2}$/.test(hex)) {
        out.push(parseInt(hex, 16))
        i += 2
      } else {
        out.push(c.charCodeAt(0))
      }
    } else {
      out.push(c.charCodeAt(0))
    }
  }
  return new Uint8Array(out)
}

export function decodeRfc2047(s: string): string {
  const re = /=\?([^?]+?)\?([bBqQ])\?([^?]*?)\?=/g
  let result = ''
  let lastIndex = 0
  let prevWasEncoded = false
  let m: RegExpExecArray | null
  while ((m = re.exec(s)) !== null) {
    const charset = m[1]
    const enc = m[2]
    const encoded = m[3]
    if (charset === undefined || enc === undefined || encoded === undefined) continue
    const gap = s.slice(lastIndex, m.index)
    // Whitespace between two adjacent encoded words is not significant.
    if (!(prevWasEncoded && /^\s*$/.test(gap))) result += gap
    const bytes = enc.toLowerCase() === 'b' ? base64ToBytes(encoded) : qDecodeToBytes(encoded)
    result += decodeBytes(bytes, charset)
    lastIndex = re.lastIndex
    prevWasEncoded = true
  }
  result += s.slice(lastIndex)
  return result
}

// ───────────────────────── Content-Type ─────────────────────────

type ContentType = { type: string; params: Map<string, string> }

function parseParams(s: string, out: Map<string, string>): void {
  const re = /([^=;\s]+)\s*=\s*(?:"((?:[^"\\]|\\.)*)"|([^;]*))/g
  let m: RegExpExecArray | null
  while ((m = re.exec(s)) !== null) {
    const name = m[1]
    if (name === undefined) continue
    const quoted = m[2]
    const unquoted = m[3]
    const value = quoted !== undefined ? quoted.replace(/\\(.)/g, '$1') : (unquoted ?? '').trim()
    out.set(name.trim().toLowerCase(), value)
  }
}

function parseContentType(value: string | null): ContentType {
  const params = new Map<string, string>()
  if (value === null) return { type: 'text/plain', params }
  const semi = value.indexOf(';')
  const type = (semi === -1 ? value : value.slice(0, semi)).trim().toLowerCase()
  if (semi !== -1) parseParams(value.slice(semi + 1), params)
  return { type: type || 'text/plain', params }
}

// ───────────────────────── transfer encoding ─────────────────────────

function decodeQuotedPrintable(bytes: Uint8Array): Uint8Array {
  const out: number[] = []
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i]
    if (b === undefined) break
    if (b === 0x3d) {
      // '='
      const b1 = bytes[i + 1]
      if (b1 === NL) {
        i += 1 // soft line break =\n
        continue
      }
      if (b1 === CR && bytes[i + 2] === NL) {
        i += 2 // soft line break =\r\n
        continue
      }
      const b2 = bytes[i + 2]
      if (b1 !== undefined && b2 !== undefined) {
        const hex = String.fromCharCode(b1) + String.fromCharCode(b2)
        if (/^[0-9a-fA-F]{2}$/.test(hex)) {
          out.push(parseInt(hex, 16))
          i += 2
          continue
        }
      }
      out.push(b) // stray '='
    } else {
      out.push(b)
    }
  }
  return new Uint8Array(out)
}

function decodeBase64Bytes(bytes: Uint8Array): Uint8Array {
  const text = bytesToLatin1(bytes).replace(/\s+/g, '')
  return new Uint8Array(Buffer.from(text, 'base64'))
}

// ───────────────────────── multipart / html ─────────────────────────

function splitMultipart(bytes: Uint8Array, boundary: string): Uint8Array[] {
  const s = bytesToLatin1(bytes)
  const segments = s.split('--' + boundary)
  const parts: Uint8Array[] = []
  for (let i = 1; i < segments.length; i++) {
    let seg = segments[i]
    if (seg === undefined) continue
    if (seg.startsWith('--')) break // closing delimiter
    seg = seg.replace(/^[ \t]*\r?\n/, '').replace(/\r?\n[ \t]*$/, '')
    parts.push(latin1ToBytes(seg))
  }
  return parts
}

function decodeEntities(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
}

function stripHtml(html: string): string {
  const withBreaks = html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<p\b[^>]*>/gi, '\n')
    .replace(/<div\b[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
  return decodeEntities(withBreaks)
}

function decodeLeaf(bodyBytes: Uint8Array, h: Headers, ct: ContentType): string {
  const cte = (header(h, 'content-transfer-encoding') ?? '').trim().toLowerCase()
  let bytes = bodyBytes
  if (cte === 'quoted-printable') bytes = decodeQuotedPrintable(bodyBytes)
  else if (cte === 'base64') bytes = decodeBase64Bytes(bodyBytes)
  return decodeBytes(bytes, ct.params.get('charset') ?? '')
}

type Collected = { plain: string | null; html: string | null }

function collectParts(bytes: Uint8Array, h: Headers, acc: Collected): void {
  const ct = parseContentType(header(h, 'content-type'))
  if (ct.type.startsWith('multipart/')) {
    const boundary = ct.params.get('boundary')
    if (boundary === undefined || boundary === '') return
    for (const part of splitMultipart(bytes, boundary)) {
      const { headerBytes, bodyBytes } = splitMessage(part)
      collectParts(bodyBytes, parseHeaders(headerBytes), acc)
    }
    return
  }
  if (ct.type === 'text/plain') {
    if (acc.plain === null) acc.plain = decodeLeaf(bytes, h, ct)
  } else if (ct.type === 'text/html') {
    if (acc.html === null) acc.html = stripHtml(decodeLeaf(bytes, h, ct))
  }
}

export function decodeBody(bodyBytes: Uint8Array, h: Headers): string {
  const acc: Collected = { plain: null, html: null }
  collectParts(bodyBytes, h, acc)
  let text = acc.plain ?? acc.html ?? ''
  text = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  text = text
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/, ''))
    .join('\n')
  text = text.replace(/\n+$/, '')
  if (text.length > 65536) text = text.slice(0, 65536) + '\n[truncated]'
  return text
}
