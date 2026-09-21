// Streaming JSONL checkpoint I/O. Every line is one record validated against a
// zod schema on read — a checkpoint from an older run is never trusted.
//
// Temporary home: the parse/thread stages own pipeline/lib/checkpoint.ts with
// the same signatures. Once that file exists, these imports switch to it and
// this file is removed.
import { createReadStream, createWriteStream, existsSync, writeFileSync } from 'node:fs'
import { createInterface } from 'node:readline'
import { once } from 'node:events'
import type { z } from 'zod'

export function checkpointExists(path: string): boolean {
  return existsSync(path)
}

export async function* readJsonl<T>(path: string, schema: z.ZodType<T>): AsyncGenerator<T> {
  const rl = createInterface({ input: createReadStream(path, { encoding: 'utf8' }), crlfDelay: Infinity })
  let n = 0
  try {
    for await (const line of rl) {
      n++
      const trimmed = line.trim()
      if (!trimmed) continue
      let json: unknown
      try {
        json = JSON.parse(trimmed)
      } catch (e) {
        throw new Error(`${path}:${n}: invalid JSON — ${e instanceof Error ? e.message : String(e)}`)
      }
      const parsed = schema.safeParse(json)
      if (!parsed.success) throw new Error(`${path}:${n}: schema mismatch — ${parsed.error.message}`)
      yield parsed.data
    }
  } finally {
    rl.close()
  }
}

export async function writeJsonl<T>(
  path: string,
  schema: z.ZodType<T>,
  rows: Iterable<T> | AsyncIterable<T>,
): Promise<number> {
  const ws = createWriteStream(path, { encoding: 'utf8' })
  let count = 0
  try {
    for await (const row of rows) {
      const line = JSON.stringify(schema.parse(row)) + '\n'
      if (!ws.write(line)) await once(ws, 'drain')
      count++
    }
  } finally {
    await new Promise<void>((resolve, reject) => {
      ws.on('error', reject)
      ws.end(resolve)
    })
  }
  return count
}

export function writeJson(path: string, data: unknown): void {
  writeFileSync(path, JSON.stringify(data, null, 2) + '\n')
}
