// JSONL checkpoint I/O. Every stage writes its output as one JSON record per
// line and reads the prior stage's output back through a zod schema — a
// checkpoint written by an older run is never trusted (see types.ts).
import { existsSync, statSync } from 'node:fs'
import { writeFileSync } from 'node:fs'
import type { z } from 'zod'

export async function writeJsonl<T>(path: string, items: AsyncIterable<T> | Iterable<T>): Promise<number> {
  const writer = Bun.file(path).writer()
  let count = 0
  const isAsync = Symbol.asyncIterator in items
  if (isAsync) {
    for await (const item of items as AsyncIterable<T>) {
      writer.write(JSON.stringify(item) + '\n')
      count++
    }
  } else {
    for (const item of items as Iterable<T>) {
      writer.write(JSON.stringify(item) + '\n')
      count++
    }
  }
  await writer.end()
  return count
}

export async function* readJsonl<T>(path: string, schema: z.ZodType<T>): AsyncGenerator<T> {
  const decoder = new TextDecoder()
  let carry = ''
  for await (const chunk of Bun.file(path).stream()) {
    carry += decoder.decode(chunk, { stream: true })
    let nl = carry.indexOf('\n')
    while (nl !== -1) {
      const line = carry.slice(0, nl)
      carry = carry.slice(nl + 1)
      if (line.length > 0) yield schema.parse(JSON.parse(line))
      nl = carry.indexOf('\n')
    }
  }
  carry += decoder.decode()
  const last = carry.trim()
  if (last.length > 0) yield schema.parse(JSON.parse(last))
}

export function checkpointExists(path: string): boolean {
  return existsSync(path) && statSync(path).size > 0
}

export function writeJson(path: string, value: unknown): void {
  writeFileSync(path, JSON.stringify(value, null, 2) + '\n')
}
