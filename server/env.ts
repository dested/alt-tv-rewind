import { z } from 'zod'

const schema = z.object({
  DATABASE_URL: z.string().url(),
  BETTER_AUTH_SECRET: z.string().min(32, 'BETTER_AUTH_SECRET must be at least 32 chars'),
  BETTER_AUTH_URL: z.string().url().default('http://localhost:7485'),
  // Sign-up is closed by default: the only account is the admin who fixes
  // attributions. Flip to "true" once to create it, then back.
  ALLOW_SIGNUP: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  // Used by the ingest pipeline only (classify → Jev, enrich/recap → Claude);
  // the web server never calls a model.
  TYPESAFE_API_KEY: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().optional(),
})

export const env = schema.parse(process.env)
