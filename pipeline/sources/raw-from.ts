// Recovers the poster's display name and hashed key from the raw bytes of one
// Usenet message inside an mbox artifact. The email address is used only to hash
// (posterKey); it is never returned, stored, or logged. One file descriptor is
// cached per artifact path so the ~390k random reads across the corpus don't
// re-open the same 2.4GB files; call closeRawFiles() when the pass is done.
import { closeSync, openSync, readSync } from 'node:fs'
import { header, parseHeaders, splitMessage } from '../lib/mime'
import { parseFrom, posterKey } from '../lib/normalize'

const fds = new Map<string, number>()

function fdFor(path: string): number {
  let fd = fds.get(path)
  if (fd === undefined) {
    fd = openSync(path, 'r')
    fds.set(path, fd)
  }
  return fd
}

export function readRawFrom(path: string, byteOffset: number, byteLength: number): { name: string; posterKey: string } {
  const fd = fdFor(path)
  const buf = Buffer.alloc(byteLength)
  let read = 0
  while (read < byteLength) {
    const n = readSync(fd, buf, read, byteLength - read, byteOffset + read)
    if (n === 0) break // short read at EOF; parse what we have
    read += n
  }
  const { headerBytes } = splitMessage(buf.subarray(0, read))
  const h = parseHeaders(headerBytes)
  const from = parseFrom(header(h, 'from') ?? '')
  return { name: from.name, posterKey: posterKey(from.email, from.name) }
}

export function closeRawFiles(): void {
  for (const fd of fds.values()) closeSync(fd)
  fds.clear()
}
