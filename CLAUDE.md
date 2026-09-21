# CLAUDE.md

Briefing for an LLM extending this codebase. Read `cliffnotes.md` first (the map), `ui.md` for anything visual, `decisions.md` before reversing a choice. This file holds only the rules that break things when ignored.

## What this is

alt.tv.rewind — a public archive of `alt.tv.*` Usenet newsgroups aligned to episode air dates, with an offline pipeline (`pipeline/`) that ingests archive.org mboxes into Postgres and a Bun + Express 5 + Vite SSR + React Router 7 + tRPC 11 + Prisma 7 site (`server/`, `src/`) that reads it. Started from sal-starter; the starter's SSR/hydration/theme plumbing is unchanged.

## Hard rules

1. **Path alias `~/*` → `src/*`** (client only; `tsconfig.json` + `vite.config.ts`). `server/` and `pipeline/` use relative imports.
2. **`./server/*` and `./pipeline/*` are server-only.** Never import them from `src/` except `import type` (`src/lib/trpc.tsx` → `AppRouter`).
3. **Routes are explicit** `RouteObject[]` in `src/app/routes.tsx`. Every data route prefetches in **both** loader branches (SSR `requestContext`, browser `getBrowserClients()`), or the page flickers on client nav. Loaders translate tRPC `NOT_FOUND` into a thrown 404 `Response` (`isNotFound`).
4. **tRPC returns JSON-safe data** — `Date` → ISO string at the procedure (`iso()` in `server/routers/shared.ts`). All formatting happens in `src/lib/format.ts` with a fixed locale + `America/New_York`, so SSR and hydration match.
5. **Day resolution is real state.** `Message.dateOnly` / `Thread.startedDateOnly` mean the header had no clock. Never show a time or an hour-based phrase for them: `formatDateTime(iso, dateOnly)`, `relativeToAir(hoursAfterAir, daysAfterAir, postedAt)` where `hoursAfterAir` is null for date-only. Reaction curves are per ET calendar day.
6. **Migrations only.** `bun run db:migrate` (dev) / `db:deploy`. `prisma db push` is forbidden — the `message.search` tsvector is maintained by the trigger `message_search_update()`, which Prisma cannot see. Prisma refuses `migrate reset` under Claude Code; reset by `DROP SCHEMA public CASCADE` in psql, then `db:deploy`. Run `bun run db:generate` after schema edits.
7. **Type safety:** `strict` + `noUncheckedIndexedAccess`; never `any`; no `as` to paper over a mismatch; zod at every boundary (checkpoint records in `pipeline/lib/types.ts`, LLM outputs, env). `bun run typecheck` must be clean before reporting done.
8. **Poster privacy:** email addresses are hashed to `Poster.key` at parse time and never stored or rendered. Display names only.
9. **Emoji appear only as taxonomy glyphs** from `src/lib/taxonomy.ts`. No eyebrow/kicker labels above headings; headings never end in a period (`ui.md`).
10. **Env vars are zod-validated at import** (`server/env.ts`); add new ones there and to `.env.example`. `prisma.config.ts` loads `.env` itself for the Prisma CLI — keep that block. Never print `TYPESAFE_API_KEY` / `ANTHROPIC_API_KEY`.
11. **Never commit** `.env`, `data/archives/`, `data/work/`, `dist/`.
12. **Pipeline stages are checkpointed and resumable.** Model stages (`classify`, `enrich`) append to their JSONL and skip done keys; `--force` truncates. Never run a `--force` smoke test against a show whose real run is in progress. Dry-run first: `CLASSIFY_DRY_RUN=1`, `ENRICH_DRY_RUN=1`; cap with `CLASSIFY_LIMIT` / `ENRICH_LIMIT`.
13. **Dev port is 7485** (`PORT` in `.env`), HMR rides the same `http.Server`. Never 3000.
14. **Server code logs through `log.*` in `server/logger.ts`**; pipeline stages log through `ctx.log`.
15. **shadcn here has no `asChild`** (no radix Slot) — style a `Link` with `buttonVariants()`. Stylesheet is a `<link>` in `index.html`; `@import` new CSS from `app.css`, never from a component.

## Where things go

- New page → `src/app/<name>.tsx` + route + loader in `routes.tsx`. New procedure → the matching file in `server/routers/`, mounted in `server/router.ts`. New table/column → `prisma/schema.prisma` + `bun run db:migrate --name <slug>`.
- New pipeline stage → `pipeline/stages/<name>.ts` exporting `run: Stage['run']`, record schema in `lib/types.ts`, name added to `STAGES` in order.
- New show → `bun run pipeline add-show <newsgroup> --name "<Show>"`; curation in `data/shows/<slug>/aliases.json` and `phrases.json`.
- Working docs → `plans/YYYY-MM-DD-<slug>.md`, never a loose root `.md`.

## Verify

```
bun run typecheck
bun test                       # pipeline unit tests
bun run dev                    # then curl http://localhost:7485/seinfeld/s07e24-the-invitations
bun run pipeline ingest seinfeld --only stats   # cheap; classify/enrich/recap cost money
```
