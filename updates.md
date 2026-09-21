# alt-tv-rewind — Updates

> Terse, newest-first log: what was asked → what was done. One entry per finished task.

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
