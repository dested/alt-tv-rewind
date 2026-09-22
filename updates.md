# alt-tv-rewind — Updates

> Terse, newest-first log: what was asked → what was done. One entry per finished task.

## 2026-09-21 — Source integration: catalog, additive schema, resumable import, source-location UI

Ask: execute plans/2026-09-21-fable-source-integration-handoff.md end to end (fable-opus mode): catalog the research corpus, integrate it with provenance, show where every post came from.
Done: migration `20260921200000_sources` (source/artifact/source_record/observation/record_show/contribution/message_source; archive→source, per-show newsgroup uniqueness; thread.import_key; message.source_record_id/date_precision; 9 legacy sources backfilled). `pipeline sources catalog|import|report`: 7 sources / 388,353 records / 391,755 observations inventoried with raw provenance; deterministic screen → 95,849 (record, show) dispositions; per-source JWZ + cross-source union → 68,425 conversations; 281 capsules mapped (278) with 41,292 extracted contributions kept metadata-only; forum 1,324 posts / 4 topics with minute-precision UTC separate from 2024 captures. Imported (local DB): family-guy 4,387 + 1,270 linked, south-park 1,324 forum + 6,004 Usenet, simpsons 27,902, seinfeld 3,245; legacy 665,499 untouched; re-runs idempotent. UI: per-post SourceLine (compact gutter / full links), timing tags, source names on rows and hits, episode community filter, `/sources`, `/sources/:key`, `/sources/:key/records/:recordId`, `/:show/sources`. Fixed the loader's UTC-ms live/retro rule to ET days; found and fixed a timestamptz cast that shifted instants by the session zone. Jev unavailable (402) → heuristic attribution only. Verified: typecheck, 179 tests, build, curl + bx flows, Playwright viewport pass (masthead now wraps on mobile). Not deployed.
Touched: prisma/schema.prisma + migration, pipeline/sources/*, pipeline/lib/{db,timing}.ts, pipeline/stages/load.ts, pipeline/cli.ts, server/routers/{shared,threads,episodes,search,sources}.ts, server/router.ts, src/app/{routes,layout,thread,episode,search,sources,source,source-record,show-sources}.tsx, src/components/{source-line,thread-row}.tsx, src/lib/api-types.ts, cliffnotes.md, ui.md, decisions.md, plans/2026-09-21-source-integration-implementation.md, plans/2026-09-21-source-catalog-report.json.

## 2026-09-21 — Fable handoff for complete cataloging and source-aware app integration

Ask: provide one document Fable can use to finish cataloging, import the new data and show original source locations in the app.
Done: self-contained execution brief with current inventories/paths, mandatory relevance and episode cataloging, capsule contribution extraction, identity/migration/import constraints, source-location UI behavior and concrete acceptance checks. Explicitly distinguishes completed collection from pending implementation and local-only files from git-clone contents.
Touched: plans/2026-09-21-fable-source-integration-handoff.md, cliffnotes.md, updates.md. No application/database changes.

## 2026-09-21 — Original-era discourse research, collection and source-aware files

Ask: deeply research and collect 1990s–2000s Family Guy, Simpsons, South Park and Seinfeld discourse; use agents by source; organize collected files with provenance before changing the DB.
Done: verified source catalog, five full additional Usenet mboxes (389,755 raw records), 281 Simpsons capsules, 91 recovered South Park forum pages (1,324 unique posts); 9,426 distinct Usenet candidates / 10,466 show memberships. Three offline source adapters retain source/native IDs, dates, raw-file observations and hashes; coordinator validates/indexes the bundle. Found February 1, 1999 Family Guy pilot reactions and gaps in main-group coverage. No app/DB/deployment changes. Details: `plans/2026-09-21-original-discourse-research.md`, `plans/2026-09-21-source-aware-collection.md`.
Touched: plans/2026-09-21-* research/scripts/inventories; local gitignored data/archives/research-2026-09-21/; cliffnotes.md, decisions.md, updates.md.

## 2026-09-21 — Deploy to drydock at tv-rewind.dested.com; full DB pushed up

Ask: "deploy it, tv-rewind.dested.com. drydock supports all this. create a new db and push local up there".
Done: created drydock project `tv-rewind` (ssr/bun/prisma/database, domain tv-rewind.dested.com, size `m`, health `/healthz`, pre-deploy overridden from the detected `prisma db push` to `bun run db:deploy` per hard rule #6). Drydock provisioned ECR/log group/Postgres db `tv_rewind`/`BETTER_AUTH_*`, committed managed files to origin/main (GitHub API), pointed the A record at the EIP. Pushed the whole local DB (2.18 GB; `pg_dump -Fc --no-owner` → `pg_restore -j4` over the box's 5432): 665,499 messages, 112,913 threads, 84,490 posters, 9 shows, all with the `message_search_trg` trigger + `message_search_idx` GIN index and populated tsvector; `_prisma_migrations` intact (7 applied → pre-deploy is a no-op). Verified live over prod TLS: `/healthz`, home, episode, `/:show/search` (festivus hits), people all 200; rollout COMPLETED, CI green.
Touched: no app code — infra only (drydock project + managed files on origin/main); cliffnotes.md, decisions.md.

## 2026-09-21 — Thread page: Transcript / Reply chains toggle; colon and pipe quoting

Ask: "wait i still like seeing the reply chains — support both views".
Done: `?view=tree` on the thread page renders nested reply chains (22px avatar header row, rail `ml-[0.6875rem] border-l pl-5`, indent capped at depth 6, collapse buttons with descendant counts); default stays the flat transcript; switcher pills on the top rule line; same `#m{id}` anchors in both. Parser now treats `: ` and `| ` as quote markers when followed by a space or another marker (3% of posts used colon quoting and rendered as one run-on paragraph). Search snippet regexp fix from the previous entry verified live.
Touched: src/app/thread.tsx, src/components/avatar.tsx, src/lib/usenet.ts (+test), ui.md, cliffnotes.md.

## 2026-09-21 — Paper redesign v3, transcript threads, stable thread slugs, five more shows

Ask: "i hate this brutalist look… make it modern… feel like 90s but not tacky"; then "too far indented… no color changing, make it light. pick a design"; plus "in another agent do: southpark futurama family-guy beavis-n-butthead daria".
Done: `ui.md` v3 — one cream-paper theme (dark mode, theme toggle and pre-paint script removed), Newsreader + Inter, red-orange brand / print-blue links, ruled `thread-row` listings replacing cards, flat transcript thread page ordered by reply with "↩ name" gutter links (`usenet.ts` parser: paragraph unwrap, folded quotes, signature cut, redaction). `Thread.slug` (12-hex content hash, migration `20260921060000_thread_slug`, NULL-safe backfill) and `/:show/thread/:slug` everywhere; `threads.get` takes `{show, slug}`. Five shows downloaded, resolved and loaded structurally (270k messages; first load attempt died on the loader's LATERAL slug query and a column dropped mid-migration — fixed, reloaded).
Touched: ui.md, src/styles/app.css, src/app/*, src/components/{thread-row,section-heading,avatar,message-body}.tsx, src/lib/usenet.ts, prisma/schema.prisma + migration, pipeline/stages/load.ts, server/routers/{shared,threads,search,posters,episodes,shows}.ts, data/shows.json + data/shows/<5 slugs>/.

## 2026-09-21 — alt.tv.rewind: the whole product, first four shows

Ask: turn the Seinfeld mbox viewer into a public, generic Usenet-vs-air-date archive on the full sal-starter stack; Jev for classification; categories 🔥😂😡🤯🧠; automate adding shows; then Simpsons, King of the Hill, Friends.
Done: schema + 4 migrations (FTS trigger, day-only flags); pipeline parse→thread→episodes(TVMaze)→attribute→classify(Jev)→enrich(Haiku batches)→load→stats→recap(Opus); `add-show` command; routers shows/episodes/threads/search/posters/admin; pages home/show/season/episode/thread/search/people/poster; hand-rolled SVG charts; day-resolution timing contract end to end; Jev 255-label roster for big shows; `ANALYZE` before the load self-join. Seinfeld 157k msgs live on :7485 with 12,675 threads classified (TypeSafe credits ran out — remainder ~$6, other three ~$14); Simpsons 135k / KOTH 7k / Friends 95k loaded without LLM stages. Enrich + recap not yet run. Board unreachable this session.
Touched: everything — see cliffnotes.md.

## 2026-09-11 — kill the unstyled flash on load + other load-time jank

Ask: fix the FOUC every load; find similar jank; make it incredible.
Done: stylesheet moved to a head `<link>` (FOUC gone in dev); flash-free dark mode with nav toggle + `color-scheme` + synced `theme-color`; `<ScrollRestoration />`; client-nav tRPC prefetch via `getBrowserClients()`; HMR websocket shares the Express server (fixed-port collision between clones); immutable `Cache-Control` for hashed assets. e2e screenshot baselines NOT regenerated (no DB creds in this session) — run `bun run test:e2e:update`.
Touched: index.html, server.ts, src/App.tsx, src/index.tsx, src/app/layout.tsx, src/app/routes.tsx, src/lib/trpc.tsx, src/lib/theme.ts, src/components/theme-toggle.tsx, src/styles/app.css, CLAUDE.md, MIGRATION.md, cliffnotes.md, ui.md, decisions.md
