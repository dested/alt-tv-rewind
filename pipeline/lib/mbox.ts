// Streaming mbox reader. Yields the raw bytes of each message body-with-headers,
// bounded by the `From ` separator lines a Google Groups export writes (e.g.
// `From -4780430503708643449` — `From ` then a signed integer, no date). Memory
// stays bounded by one chunk plus one message; the 226MB Seinfeld file is never
// held whole.
//
// Boundary is a line that starts with exactly `From ` (0x46 0x72 0x6F 0x6D 0x20).
// mboxo quotes body lines that would look like separators as `>From `, so the
// leading-newline + `From ` pattern already excludes them.

const NL = 0x0a
const CR = 0x0d
// "From " — the six bytes that, at the start of a line, open a new message.
const FROM = new Uint8Array([0x46, 0x72, 0x6f, 0x6d, 0x20])

function startsWithFrom(buf: Uint8Array, at: number): boolean {
  if (at + FROM.length > buf.length) return false
  for (let i = 0; i < FROM.length; i++) if (buf[at + i] !== FROM[i]) return false
  return true
}

// Skip from the separator line's first byte to the byte after its newline.
function afterSeparatorLine(buf: Uint8Array, at: number): number {
  let i = at
  while (i < buf.length && buf[i] !== NL) i++
  return i < buf.length ? i + 1 : buf.length
}

export async function* readMbox(path: string): AsyncGenerator<Uint8Array> {
  let buf = new Uint8Array(0)
  let messageStart = -1 // byte offset (within buf) of the current message's first content byte

  const append = (chunk: Uint8Array) => {
    const next = new Uint8Array(buf.length + chunk.length)
    next.set(buf)
    next.set(chunk, buf.length)
    buf = next
  }

  // Trim already-emitted bytes so buf never grows past one message + tail.
  const compact = (from: number) => {
    buf = buf.slice(from)
    messageStart -= from
  }

  const stream = Bun.file(path).stream()
  for await (const chunk of stream) {
    append(chunk)

    if (messageStart === -1) {
      // Before the first message: file may open with `From ` at offset 0.
      if (buf.length >= FROM.length) {
        if (startsWithFrom(buf, 0)) {
          messageStart = afterSeparatorLine(buf, 0)
        } else {
          // Not a well-formed mbox start; treat everything as one message body.
          messageStart = 0
        }
      } else {
        continue
      }
    }

    // Emit every complete message whose next `\nFrom ` boundary is fully in buf.
    // Scan only the safe region; the last FROM.length+1 bytes may straddle chunks.
    let i = messageStart
    const safeEnd = buf.length - (FROM.length + 1)
    while (i <= safeEnd) {
      if (buf[i] === NL && startsWithFrom(buf, i + 1)) {
        let end = i // exclude the boundary newline
        if (end > messageStart && buf[end - 1] === CR) end-- // strip trailing CR
        yield buf.slice(messageStart, end)
        messageStart = afterSeparatorLine(buf, i + 1)
        i = messageStart
        continue
      }
      i++
    }

    // Keep unemitted bytes small: drop everything before the current message.
    if (messageStart > 0) compact(messageStart)
  }

  // Final message (no trailing separator).
  if (messageStart !== -1 && messageStart < buf.length) {
    let end = buf.length
    while (end > messageStart && (buf[end - 1] === NL || buf[end - 1] === CR)) end--
    if (end > messageStart) yield buf.slice(messageStart, end)
  }
}
