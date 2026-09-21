# alt-tv-rewind — Updates

> Terse, newest-first log: what was asked → what was done. One entry per finished task.

## 2026-09-21 — alt.tv.rewind: the whole product, first four shows

Ask: turn the Seinfeld mbox viewer into a public, generic Usenet-vs-air-date archive on the full sal-starter stack; Jev for classification; categories 🔥😂😡🤯🧠; automate adding shows; then Simpsons, King of the Hill, Friends.
Done: schema + 4 migrations (FTS trigger, day-only flags); pipeline parse→thread→episodes(TVMaze)→attribute→classify(Jev)→enrich(Haiku batches)→load→stats→recap(Opus); `add-show` command; routers shows/episodes/threads/search/posters/admin; pages home/show/season/episode/thread/search/people/poster; hand-rolled SVG charts; day-resolution timing contract end to end; Jev 255-label roster for big shows; `ANALYZE` before the load self-join. Seinfeld 157k msgs live on :7485 with 12,675 threads classified (TypeSafe credits ran out — remainder ~$6, other three ~$14); Simpsons 135k / KOTH 7k / Friends 95k loaded without LLM stages. Enrich + recap not yet run. Board unreachable this session.
Touched: everything — see cliffnotes.md.

## 2026-09-11 — kill the unstyled flash on load + other load-time jank

Ask: fix the FOUC every load; find similar jank; make it incredible.
Done: stylesheet moved to a head `<link>` (FOUC gone in dev); flash-free dark mode with nav toggle + `color-scheme` + synced `theme-color`; `<ScrollRestoration />`; client-nav tRPC prefetch via `getBrowserClients()`; HMR websocket shares the Express server (fixed-port collision between clones); immutable `Cache-Control` for hashed assets. e2e screenshot baselines NOT regenerated (no DB creds in this session) — run `bun run test:e2e:update`.
Touched: index.html, server.ts, src/App.tsx, src/index.tsx, src/app/layout.tsx, src/app/routes.tsx, src/lib/trpc.tsx, src/lib/theme.ts, src/components/theme-toggle.tsx, src/styles/app.css, CLAUDE.md, MIGRATION.md, cliffnotes.md, ui.md, decisions.md
