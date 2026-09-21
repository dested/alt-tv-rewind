# alt.tv.rewind — CliffNotes

> Living map of the project. Read this before any coding session.
> Last updated: 2026-09-21. Visual language → `ui.md` · settled choices → `decisions.md` · task log → `updates.md`.

## What this is

A public archive that lines up 1990s–2000s Usenet `alt.tv.*` newsgroups against the original air dates of the show they discuss. Click an episode → see what the newsgroup said the morning after it aired: thread volume by day, the biggest threads, the loved/hated/prediction/theory buckets, the best pull quotes, then everything posted about it in the years since. Generic across shows: one registry, one command adds a newsgroup. Built on sal-starter (Bun · Express 5 + Vite SSR · React Router 7 · tRPC 11 · Prisma 7 · Tailwind 4 · better-auth).

Repo: https://github.com/dested/alt-tv-rewind · dev: http://localhost:7485

## Quick reference

- **Dev:** `bun run dev` → http://localhost:7485 (HMR shares the port). Never 3000.
- **Typecheck:** `bun run typecheck` (`tsgo --noEmit`) — a task is not done while it's red.
- **Pipeline tests:** `bun test` (= `bun test pipeline`).
- **DB:** Postgres `alt_tv_rewind`, **migrations only** (`bun run db:migrate` dev / `db:deploy` prod). `prisma db push` is forbidden — it cannot see the FTS trigger. Prisma refuses `migrate reset` under Claude Code; reset with `DROP SCHEMA public CASCADE; CREATE SCHEMA public;` via psql then `db:deploy`.
- **Add a show:** `bun run pipeline add-show alt.tv.frasier --name "Frasier" [--slug frasier] [--tvmaze "Frasier"] [--no-ingest]` — downloads the archive.org mbox, resolves TVMaze, registers in `data/shows.json`, runs the full ingest.
- **Re-run stages:** `bun run pipeline ingest <slug> [--from <stage>] [--only a,b,c] [--force]`.
- **Env (`.env`, gitignored):** `DATABASE_URL`, `BETTER_AUTH_URL=http://localhost:7485`, `BETTER_AUTH_SECRET`, `PORT=7485`, `ALLOW_SIGNUP=false`, `TYPESAFE_API_KEY` (classify), `ANTHROPIC_API_KEY` (enrich/recap). Keys are never printed or committed.
- **Health:** `GET /healthz`.
- **Server-only code lives in `./server/` and `./pipeline/`** — never import from `src/*` except `import type`.

## Directory structure

```
server.ts                    Express entry (dev + prod): /healthz, auth + tRPC mounts, Vite SSR
server/
├── env.ts                   zod env (ALLOW_SIGNUP string→boolean; API keys optional)
├── auth.ts                  better-auth, disableSignUp unless ALLOW_SIGNUP — admin only
├── prisma.ts · trpc.ts · logger.ts
├── router.ts                appRouter = { shows, episodes, threads, search, posters, admin }
└── routers/
    ├── shared.ts            ThreadCard type + threadCardSelect + mapThreadCards; daysBetweenAirAndPost (ET calendar days); iso()
    ├── shows.ts             list · get (seasons, archive, topEpisodes, mostLoved/Hated) · timeline · thenVsNow · phrases
    ├── episodes.ts          list(slug, season) · get(slug, episode) → episode, breakdown, reactionByDay (−1..+14), quotes, prev/next
    ├── threads.ts           byEpisode(episodeId, relation, filter, sort, cursor) · get(id) → thread + messages · latest
    ├── search.ts            query — websearch_to_tsquery + ts_headline (U+0001/2 markers → <mark> client-side)
    ├── posters.ts           get(id) · top(slug) · prophets(slug)
    └── admin.ts             setThreadEpisode · setThreadSpam · setThreadClassification (protected)
pipeline/                    offline ingest; every stage reads/writes JSONL checkpoints in data/work/<slug>/
├── cli.ts                   ingest | add-show | download
├── add-show.ts · download.ts (archive.org usenet-alt/<group>.mbox.zip, yauzl)
├── lib/
│   ├── types.ts             zod contracts for every checkpoint record + STAGES + StageContext
│   ├── context.ts           ROOT/DATA_DIR, registry load/save, buildContext
│   ├── mbox.ts · mime.ts · normalize.ts (parseDate → {iso, dateOnly}) · spam.ts · text.ts · jwz.ts (threading)
│   ├── tvmaze.ts · episode-index.ts · scoring.ts (attribution)
│   ├── thread-text.ts       ThreadInput: opener + ≤4 early replies, sig-cut, truncated (shared by classify/enrich)
│   ├── jev.ts               Jev question set + state + toClassification
│   ├── claude.ts            Anthropic client, EnrichOutput (zod v4), prompts, structured-output probe
│   ├── checkpoint.ts · db.ts
│   └── *.test.ts            bun tests (66)
└── stages/
    parse → thread → episodes → attribute → classify → enrich → load → stats → recap
data/
├── shows.json               registry: {slug, name, newsgroup, tvmazeQuery, tvmazeId, liveWindowDays}
├── shows/<slug>/            episodes.json (TVMaze snapshot) · aliases.json (title → nicknames) · phrases.json (catchphrase regexes)
├── archives/                *.mbox (gitignored)
└── work/<slug>/             checkpoints + *-summary.json (gitignored)
src/
├── app/
│   ├── routes.tsx           RouteObject[] + loaders (SSR ctx / getBrowserClients(); isNotFound → 404)
│   ├── layout.tsx           wordmark, show switcher, People, in-show search, admin sign-out
│   ├── home.tsx · show.tsx · season.tsx · episode.tsx · thread.tsx · search.tsx · people.tsx · poster.tsx · sign-in.tsx
│   └── error-boundary.tsx
├── components/
│   ├── thread-row.tsx       ruled listing row (avatar, subject, timing, glyphs) — the only thread listing
│   ├── message-body.tsx     renders usenet.ts blocks: paragraphs, folded quotes, pre, no signature
│   ├── avatar.tsx           poster monogram, hue from posterHue(name)
│   ├── section-heading · episode-card · reaction-curve · volume-timeline · then-vs-now · phrase-grid · sparkline
│   ├── filter-tabs · badge · stat-row · stat-line · admin-fix-episode · ui/
├── lib/
│   ├── format.ts            ALL dates go through here (America/New_York, en-US); relativeToAir(hours, days, postedAt)
│   ├── taxonomy.ts          KIND / SENTIMENT / PREDICTION_OUTCOME glyph maps, EPISODE_FILTERS — the only place emoji live
│   ├── usenet.ts (+test)    message parser: unwrap paragraphs, nested quotes + attribution, signature cut, redaction, stripRe, threadOrder, posterHue
│   ├── api-types.ts         RouterOutputs / ThreadCard / EpisodeCard
│   ├── snippet.ts · thread-tree.ts · trpc.tsx · auth-client.ts · utils.ts
└── styles/app.css           the one paper theme (see ui.md): tokens, .post / .post-quote / .post-pre, mark; no dark mode
prisma/schema.prisma + migrations/   see Data model
e2e/                         Playwright smoke (stale — still the starter's sign-up/dashboard flow)
```

## Routes / URLs

| Route                                 | Page                                                                                                                                                   | Data                                   |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------- |
| `/`                                   | show picker                                                                                                                                            | `shows.list`                           |
| `/:show`                              | show home: timeline, seasons, most discussed, loved/hated then, then-vs-now, catchphrases                                                              | `shows.get/timeline/thenVsNow/phrases` |
| `/:show/season/:n`                    | season table                                                                                                                                           | `episodes.list`                        |
| `/:show/:episode`                     | **the page** — hero, recap, stat line, reaction-by-day, filter tabs, live threads ("The morning after"), best quotes, retro threads ("Over the years") | `episodes.get`, `threads.byEpisode`    |
| `/:show/thread/:slug`                 | thread reader — flat transcript in reply order, "↩ name" gutter links, badges, admin fix panel                                                         | `threads.get`                          |
| `/:show/search?q=&season=&from=&to=`  | FTS results grouped by thread                                                                                                                          | `search.query`                         |
| `/:show/people` · `/:show/people/:id` | most prolific · prophets · poster profile                                                                                                              | `posters.*`                            |
| `/sign-in`                            | admin only                                                                                                                                             | better-auth                            |

Episode slugs look like `s07e24-the-invitations`. Thread slugs are 12 hex chars of `sha256("<show>:<earliest Message-ID>")`, stable across reloads (DB ids are not — never link by id).

## Pipeline

Stages run in order; each skips when its checkpoint exists unless `--force`. Times are Seinfeld (157k messages).

| Stage           | Reads → writes                               | Notes                                                                                                                                                                                                                                                                                                           |
| --------------- | -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| parse (10s)     | mbox → `parsed.jsonl`                        | mboxo, RFC 2047/QP/base64, charset sniff, spam heuristics, `posterKey` = sha256(email)[:16]. `Date:` without a clock (61% of 1995–2000 Seinfeld) → noon UTC + `dateOnly: true`.                                                                                                                                 |
| thread (2s)     | → `threaded.jsonl`, `threads.jsonl`          | JWZ on References/In-Reply-To; subject merge only within 30 days; `startedDateOnly`.                                                                                                                                                                                                                            |
| episodes        | TVMaze → `data/shows/<slug>/episodes.json`   | cached snapshot; specials skipped.                                                                                                                                                                                                                                                                              |
| attribute (25s) | → `candidates.jsonl`                         | air-date window + title/alias scoring, ≤6 candidates; `inLiveWindow`.                                                                                                                                                                                                                                           |
| classify        | Jev → `classified.jsonl` (append, resumable) | one `systemOne` call per non-spam thread: episode (choice over the roster), kind, sentiment, hot_take, spam, pull_quote. 16-way, 18 req/s, ~7.5k tokens/req, ~$10 per 33k threads. `CLASSIFY_DRY_RUN=1`, `CLASSIFY_LIMIT=n`. Shows with >254 episodes get a per-thread roster (candidates + most recent aired). |
| enrich          | Haiku 4.5 batches → `enriched.jsonl`         | summary + prediction claim/outcome for qualifying threads (~⅓); cached system prompt; `output_config` structured output with strict-tool fallback.                                                                                                                                                              |
| load (65s)      | everything → Postgres                        | raw `pg` unnest inserts; `--force` re-loads the show.                                                                                                                                                                                                                                                           |
| stats (65s)     | SQL                                          | episode/season/poster counters, `usenetScore`, `controversy`, daily_volume, phrases.                                                                                                                                                                                                                            |
| recap           | Opus 5 → `Episode.recap`                     | one paragraph per episode from its live threads; low effort.                                                                                                                                                                                                                                                    |

## Data model

`Show` → `Season` → `Episode` (airDate, airStamp, live/retro counters, usenetScore, recap) ← `ThreadEpisode` (relation live|retro, confidence, method heuristic|llm|manual, isPrimary) → `Thread` (subject, startedAt, startedDateOnly, counters, kind, sentiment, hotTake, controversy, summary, pullQuote, prediction\*) → `Message` (postedAt, dateOnly, body, depth, parentId, `search` tsvector by trigger, GIN). `Poster` (key, displayName only — email never stored). `Archive`, `DailyVolume`, `Phrase`, `PhraseMonthly`. Enums: `ThreadKind`, `Sentiment`, `PredictionOutcome`, `EpisodeRelation`.

**Live** = thread started in `[airDate − 1d, airDate + Show.liveWindowDays]` (ET calendar days). Everything else attributed is **retro**.

## Hard rules

- **Day resolution is a first-class state.** Anything that shows a time must pass `dateOnly` (`formatDateTime(iso, dateOnly)`, `relativeToAir(hours, days, postedAt)`). Reaction analysis is per ET calendar day, never per hour.
- **All date formatting goes through `src/lib/format.ts`** (fixed locale + zone) or SSR and hydration diverge.
- **Emoji only as category glyphs from `taxonomy.ts`.** No eyebrows above headings; no terminal periods in headings (`ui.md`).
- **Never `any`, no `as` to paper over mismatches**; zod at every boundary (checkpoints, LLM output, env).
- **Migrations only**; the FTS trigger `message_search_update()` strips quoted lines (`^[ \t]*(>|\|)`) — `search.ts` mirrors that regexp in `ts_headline`.
- **Never commit `.env`, `data/archives/`, `data/work/`.**
- LLM stages are resumable by append; `--force` truncates. Don't run a `--force` smoke test while a real run is appending to the same file.

## Status

- **Done:** schema + 5 migrations; full pipeline; all routers; all pages; nine shows loaded (Seinfeld, Simpsons, King of the Hill, Friends, South Park, Futurama, Family Guy, Beavis and Butt-Head, Daria — 665k messages). Seinfeld fully classified + enriched; Simpsons ~90% classified.
- **In flight (2026-09-21):** classify Simpsons remainder → Friends → KOTH → the five new shows (blocked on TypeSafe credits); enrich re-run for the 3,429 over-length summaries (blocked on Anthropic credits); recap never run.
- **Not built:** e2e refresh, prod deploy (owner: drydock), the other 19 archive.org groups, finale live-replay / on-this-day / digest ideas.
