// Raw pg access for the load/stats stages. Prisma is only used at read time by
// the web app; the pipeline writes with batched unnest inserts for throughput.
// Every returned row crosses a zod boundary before it is trusted.
import pg from 'pg'
import { z } from 'zod'

const { Pool } = pg
type PoolClient = pg.PoolClient

const connectionString = process.env.DATABASE_URL
if (!connectionString) throw new Error('DATABASE_URL is not set — required by pipeline/lib/db.ts')

export const pool = new Pool({ connectionString, max: 4 })

export async function withClient<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect()
  try {
    return await fn(client)
  } finally {
    client.release()
  }
}

export async function inTransaction<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
  return withClient(async (c) => {
    await c.query('BEGIN')
    try {
      const result = await fn(c)
      await c.query('COMMIT')
      return result
    } catch (e) {
      await c.query('ROLLBACK')
      throw e
    }
  })
}

export type ColumnSpec = { name: string; type: string }

// Base scalar types cast the whole array (`$n::int[]`); anything else is treated
// as a user-defined type (enum) — passed as text[] and cast per element, since
// node-pg can't infer an enum array literal.
const BASE_ARRAY_TYPES = new Set([
  'text',
  'int',
  'int4',
  'integer',
  'bigint',
  'int8',
  'float8',
  'double precision',
  'real',
  'numeric',
  'boolean',
  'bool',
  'date',
  'timestamp',
  'timestamptz',
  'jsonb',
  'uuid',
])

// Per-column expression over the row-aligned `unnest($1::T[], $2::T[], …) AS u(c1, c2, …)`
// source. Enums arrive as text and are cast per element; `text[]` columns arrive as
// jsonb (one JSON array string per row) and are unpacked per row, since a nested
// Postgres array would be flattened by unnest.
function columnExpr(col: ColumnSpec, i: number): string {
  const t = col.type.toLowerCase()
  if (t === 'text[]') return `ARRAY(SELECT jsonb_array_elements_text(u.c${i}))`
  if (BASE_ARRAY_TYPES.has(t)) return `u.c${i}`
  return `u.c${i}::"${col.type}"`
}

function paramCast(col: ColumnSpec): string {
  const t = col.type.toLowerCase()
  if (t === 'text[]') return 'jsonb[]'
  if (BASE_ARRAY_TYPES.has(t)) return `${col.type}[]`
  return 'text[]'
}

const BATCH = 2000

type InsertOpts<Out extends Record<string, unknown>> = {
  returning?: string[]
  onConflict?: string // full clause, e.g. 'ON CONFLICT (key) DO NOTHING'
  returningSchema?: z.ZodType<Out>
}

// Column-parallel bulk insert. Values are transposed into one array param per
// column so a single statement inserts up to BATCH rows. When `returningSchema`
// is given, RETURNING rows are validated through it and returned.
export async function insertRows<Out extends Record<string, unknown> = Record<string, never>>(
  c: PoolClient,
  table: string,
  columns: ColumnSpec[],
  rows: ReadonlyArray<Record<string, unknown>>,
  opts?: InsertOpts<Out>,
): Promise<Out[]> {
  if (rows.length === 0) return []

  const colList = columns.map((col) => `"${col.name}"`).join(', ')
  const selectList = columns.map((col, i) => columnExpr(col, i + 1)).join(', ')
  const unnestArgs = columns.map((col, i) => `$${i + 1}::${paramCast(col)}`).join(', ')
  const aliases = columns.map((_, i) => `c${i + 1}`).join(', ')
  const conflict = opts?.onConflict ? ` ${opts.onConflict}` : ''
  const returning = opts?.returning?.length ? ` RETURNING ${opts.returning.map((r) => `"${r}"`).join(', ')}` : ''
  const sql = `INSERT INTO "${table}" (${colList}) SELECT ${selectList} FROM unnest(${unnestArgs}) AS u(${aliases})${conflict}${returning}`

  const out: Out[] = []
  for (let start = 0; start < rows.length; start += BATCH) {
    const batch = rows.slice(start, start + BATCH)
    const params: unknown[] = columns.map((col) =>
      batch.map((row) => {
        const v = row[col.name]
        if (v === undefined) return null
        return col.type.toLowerCase() === 'text[]' ? JSON.stringify(v) : v
      }),
    )
    const res = await c.query(sql, params)
    const schema = opts?.returningSchema
    if (schema) {
      const raw: unknown[] = res.rows
      for (const row of raw) out.push(schema.parse(row))
    }
  }
  return out
}
