# alt.tv.rewind — CliffNotes

> Living map of the project. Read this before any coding session.
> Last updated: 2026-09-21 (source integration). Visual language → `ui.md` · settled choices → `decisions.md` · task log → `updates.md`.

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
- **Source catalog / import (research corpus):** `bun run pipeline sources catalog [--source a,b] [--dry-run]` → `bun run pipeline sources import <show> [--dry-run] [--force]` → `bun run pipeline sources report`. Reads `data/archives/research-2026-09-21/organized/` (gitignored), writes `data/work/sources/`. Idempotent; re-runs insert nothing. After a legacy `ingest --only load --force` of a show, re-run `sources import <show>` (the legacy reload drops that archive's threads, including imported messages that had joined them).
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
├── router.ts                appRouter = { shows, episodes, threads, search, posters, sources, admin }
└── routers/
    ├── shared.ts            ThreadCard (+source) + threadCardSelect + mapThreadCards; daysBetweenAirAndPost; SourceRef/SourceLocation/PostTiming + sourceLocationFor + postTimingFor (mirrors pipeline/lib/timing.ts) + sourceRefSelect/sourceLocationSourceSelect; iso()
    ├── shows.ts             list · get (seasons, archive, topEpisodes, mostLoved/Hated) · timeline · thenVsNow · phrases
    ├── episodes.ts          list(slug, season) · get(slug, episode) → episode, breakdown, reactionByDay (−1..+14), quotes, prev/next, sources (per-community thread counts), documents (capsules)
    ├── threads.ts           byEpisode(episodeId, relation, filter, sort, source?, cursor) · get(id) → thread (+sources) + messages (+source/location/timing/additionalSourceCount) · latest
    ├── search.ts            query(…, source?) — websearch_to_tsquery + ts_headline (U+0001/2 markers → <mark> client-side); hits carry sourceName/sourceKey
    ├── posters.ts           get(id) · top(slug) · prophets(slug)
    ├── sources.ts           list · get(key) · forShow(slug) · record(key, recordId) — the source catalog (SourceLocation, dispositions, preserved records)
    └── admin.ts             setThreadEpisode · setThreadSpam · setThreadClassification (protected)
pipeline/                    offline ingest; every stage reads/writes JSONL checkpoints in data/work/<slug>/
├── cli.ts                   ingest | add-show | download | sources (→ sources/cli.ts)
├── sources/                 source-aware catalog + import — plans/2026-09-21-source-integration-implementation.md
│   ├── types.ts             zod for the organized research bundle; fixed facts (SOURCE_FACTS, FORUM_TOPICS, SHOW_TERMS); Disposition/Conversation checkpoints
│   ├── inventory.ts         DB writers: source/artifact/source_record/observation/record_show (unnest inserts; time columns are `timestamp` — ISO 'Z' strings, never timestamptz)
│   ├── catalog-usenet.ts    5 mboxes → inventory + screen.ts dispositions + conversations.ts (per-source JWZ, union by crosspost/reference) + raw-from.ts (poster key from the raw From)
│   ├── catalog-forum.ts · forum-quotes.ts        South Park forum → inventory, official-topic dispositions; [quote] → `>` grammar at import
│   ├── catalog-capsules.ts · capsule-episode.ts · capsule-extract.ts   281 capsules → documents, airdate/title episode mapping, contribution extraction (metadata_only)
│   ├── import.ts            importShow: usenet + forum projections, archive rollup, stats
│   ├── import-usenet.ts · projection.ts   conversations → thread/message; joins legacy threads by Message-ID; heuristic attribution (+ window-unique rule); classify/enrich checkpoints under data/work/sources/<show>/
│   ├── import-forum.ts      native topics → threads; per-post timing; relation live if any post is
│   └── report.ts            reconciled counts → data/work/sources/report.json
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
├── work/<slug>/             checkpoints + *-summary.json (gitignored)
├── work/sources/            catalog checkpoints (conversations.jsonl, dispositions-*.jsonl, fingerprint.json), <show>/ import checkpoints, report.json (gitignored)
└── archives/research-2026-09-21/   the research corpus + organized/ bundle (gitignored; plans/2026-09-21-source-aware-collection.md)
plans/2026-09-21-*discourse*   original-era source research, inventories, collection/audit/organization utilities
src/
├── app/
│   ├── routes.tsx           RouteObject[] + loaders (SSR ctx / getBrowserClients(); isNotFound → 404)
│   ├── layout.tsx           wordmark, show switcher, People, in-show search, admin sign-out
│   ├── home.tsx · show.tsx · season.tsx · episode.tsx · thread.tsx · search.tsx · people.tsx · poster.tsx · sign-in.tsx
│   ├── sources.tsx · source.tsx · source-record.tsx · show-sources.tsx   source catalog, one source, preserved record, per-show sources
│   └── error-boundary.tsx
├── components/
│   ├── thread-row.tsx       ruled listing row (avatar, subject, timing, source, glyphs) — the only thread listing
│   ├── message-body.tsx     renders usenet.ts blocks: paragraphs, folded quotes, pre, no signature
│   ├── source-line.tsx      per-post source label + links (full) or gutter name (compact) from SourceLocation
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
| `/:show/thread/:slug[?view=tree]`     | thread reader — flat transcript in reply order with "↩ name" gutter links, or `view=tree` nested reply chains with collapse; badges, admin fix panel   | `threads.get`                          |
| `/:show/search?q=&season=&from=&to=`  | FTS results grouped by thread                                                                                                                          | `search.query`                         |
| `/:show/people` · `/:show/people/:id` | most prolific · prophets · poster profile                                                                                                              | `posters.*`                            |
| `/:show/:episode?source=`             | "the page" morning-after list filtered to one community                                                                                                | `threads.byEpisode`                    |
| `/:show/sources`                      | sources feeding this show: coverage, volume, dispositions, links                                                                                       | `sources.forShow`                      |
| `/sources`                            | global source catalog — every community and the shows each feeds                                                                                       | `sources.list`                         |
| `/sources/:key`                       | one source: dispositions per show, captures, capsule documents                                                                                         | `sources.get`                          |
| `/sources/:key/records/:recordId`     | preserved-record view (public sources only; 404 otherwise)                                                                                             | `sources.record`                       |
| `/sign-in`                            | admin only                                                                                                                                             | better-auth                            |

Episode slugs look like `s07e24-the-invitations`. Thread slugs are 12 hex chars of `sha256("<show>:<earliest Message-ID>")`, stable across reloads (DB ids are not — never link by id).

## Pipeline

Stages run in order; each skips when its checkpoint exists unless `--force`. Times are Seinfeld (157k messages).

| Stage           | Reads → writes                               | Notes                                                                                                                                                                                                                                                                                                           |
| --------------- | -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| parse (10s)     | mbox → `messages.jsonl`                      | mboxo, RFC 2047/QP/base64, charset sniff, spam heuristics, `posterKey` = sha256(email)[:16]. `Date:` without a clock (61% of 1995–2000 Seinfeld) → noon UTC + `dateOnly: true`.                                                                                                                                 |
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

**Live** = thread started in `[airDate − 1d, airDate + Show.liveWindowDays]` (ET calendar days, `pipeline/lib/timing.ts`). Everything else attributed is **retro**. Per-post timing (`before` / `live` / `later` / `unknown`) is derived at read time in `threads.get`.

**Source catalog** (migration `20260921200000_sources`): `Source` (a community: key, kind usenet|forum|capsule, custodian, homeUrl, collectionUrl, originalStatus, publication public|metadata_only, legacy flag) → `Artifact` (a file we hold: path, sha256, format, capturedAt/retrievedAt/verifiedAt) → `SourceRecord` (one native post/document: recordId, canonicalId, externalId, author display name + source-scoped posterKey, postedAt/postedDate/datePrecision/dateRaw, body, spam) → `Observation` (every occurrence in an artifact: locator, byte range or WARC record, capturedAt, contentSha256, differsFromRecord). `RecordShow` is the reviewed disposition per (record, show): status accepted|context|excluded|needs_review, method, evidence, confidence, reason, conversationKey, inEra, importStatus, messageId. `Contribution` holds attributed pieces extracted from a capsule (kind, attribution as printed, span). Projection links: `Archive` is one row per (show, community) with `sourceId` (unique `(showId, newsgroup)`); `Thread.importKey` (`c:<16 hex>` / `forum:<source>:<topic>`) makes imports idempotent; `Message.sourceRecordId` + `MessageSource` (primary/additional) carry per-post provenance; `Message.datePrecision` (`unknown` = inherited sort date).

## Hard rules

- **Day resolution is a first-class state.** Anything that shows a time must pass `dateOnly` (`formatDateTime(iso, dateOnly)`, `relativeToAir(hours, days, postedAt)`). Reaction analysis is per ET calendar day, never per hour.
- **All date formatting goes through `src/lib/format.ts`** (fixed locale + zone) or SSR and hydration diverge.
- **Emoji only as category glyphs from `taxonomy.ts`.** No eyebrows above headings; no terminal periods in headings (`ui.md`).
- **Never `any`, no `as` to paper over mismatches**; zod at every boundary (checkpoints, LLM output, env).
- **Migrations only**; the FTS trigger `message_search_update()` strips quoted lines (`^[ \t]*(>|\|)`) — `search.ts` mirrors that regexp in `ts_headline`.
- **Never commit `.env`, `data/archives/`, `data/work/`.**
- LLM stages are resumable by append; `--force` truncates. Don't run a `--force` smoke test while a real run is appending to the same file.
- **Every `DateTime` column is `timestamp` without zone holding UTC wall clock.** In pipeline code write ISO 'Z' strings cast `::timestamp`; never pass JS `Date` objects to `pg` or cast `::timestamptz` (the session zone is local and silently shifts instants); read with `to_char(col, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`. Prisma handles it correctly in the app.
- **Legacy thread slugs are never recomputed by the source import**; only provisional `~` slugs of new import threads are rewritten. Capsule text (`contribution.text`, `source_record.body` of `metadata_only` sources) is never served.

## Status

- **Source integration (2026-09-21, local DB only — not deployed):** the research corpus is cataloged (7 sources, 388,353 records, 391,755 observations, 95,849 dispositions across four shows) and imported per [plans/2026-09-21-source-integration-implementation.md](plans/2026-09-21-source-integration-implementation.md) (decisions + run log) and [plans/2026-09-21-source-catalog-report.json](plans/2026-09-21-source-catalog-report.json) (counts). Projected: Family Guy 4,387 posts / 394 new threads (pilot-week reactions from rec.arts.animation now under S01E01), South Park 1,324 forum posts in 4 topics + 6,004 Usenet posts, The Simpsons 27,902 posts / 3,577 new threads (itchy-scratchy back to 1992) + 278 capsule documents linked (metadata only), Seinfeld 3,245 posts (61 in-era accepted; the rest is 2012–13 rec.arts.tv). Legacy 665,499 messages untouched. New threads are heuristic-attributed only (Jev has no credits; a `classified.jsonl` in `data/work/sources/<show>/` is applied by re-running `sources import`). Needs review: 396 / 648 / 374 / 232 records (family-guy / south-park / simpsons / seinfeld) and 3 capsules. Prod still runs the pre-integration DB.
- **Research collection (2026-09-21):** Family Guy, Simpsons, South Park, Seinfeld source catalog and downloads in [plans/2026-09-21-original-discourse-research.md](plans/2026-09-21-original-discourse-research.md). Five additional full Usenet archives, 281 capsule documents and four official South Park forum topics are local under `data/archives/research-2026-09-21/`. Source-aware JSONL lives in `organized/`; [format and reproduction](plans/2026-09-21-source-aware-collection.md). Every record has a source ID; observations retain raw-file provenance; show associations are separate. Imported through `pipeline sources` (above); never feed these mboxes to the one-newsgroup loader.
- **Done:** schema + 5 migrations; full pipeline; all routers; all pages; nine shows loaded (Seinfeld, Simpsons, King of the Hill, Friends, South Park, Futurama, Family Guy, Beavis and Butt-Head, Daria — 665k messages). Seinfeld fully classified + enriched; Simpsons ~90% classified.
- **Deployed (2026-09-21):** live at **https://tv-rewind.dested.com** on drydock (project `tv-rewind`, ssr/bun/prisma, size `m`, health `/healthz`, pre-deploy `bun run db:deploy`). Full local Postgres (665,499 messages incl. tsvector) pushed up via `pg_dump -Fc` → `pg_restore` over the box's temporarily-open 5432; drydock's shared Postgres is v17. Managed files (`Dockerfile`, `.github/workflows/drydock.yml`, `drydock.yaml`) live on `origin/main` (drydock committed them via the GitHub API — pull before the next local commit). CI deploys on every push to main.
- **In flight (2026-09-21):** classify Simpsons remainder → Friends → KOTH → the five new shows (blocked on TypeSafe credits); enrich re-run for the 3,429 over-length summaries (blocked on Anthropic credits); recap never run.
- **Not built:** e2e refresh, the other 19 archive.org groups, finale live-replay / on-this-day / digest ideas.
