# alt-tv-rewind — Decisions

> Append-only log of choices with rejected alternatives. Never reverse one silently — add a superseding entry.

## 2026-09-21 — Source catalog is a separate layer; the serving projection stays thread/message

**Why:** the research corpus (five extra newsgroups, the official South Park forum, 281 Simpsons Archive capsules) is shared across shows and carries multiple captures per post, which the one-newsgroup loader cannot represent. `source` / `artifact` / `source_record` / `observation` / `record_show` / `contribution` hold every collected record with provenance and a reviewed per-show disposition (migration `20260921200000_sources`); `thread` / `message` remain the reader-facing projection, linked back through `message.source_record_id` + `message_source`. `archive` became one row per (show, community) — unique on `(show_id, newsgroup)` instead of a global newsgroup — so rec.arts.animation can feed Family Guy, The Simpsons and South Park without reassignment or purge. Nine legacy sources were backfilled so every existing post names its community.
**Rejected:** one source label column on `message` (loses captures, crossposts and dispositions); re-running the legacy loader over the shared mboxes (its archive upsert would steal and delete the other show's threads; `t<n>` keys would mis-attach classifications); a second serving schema for imported posts (every page would need two code paths).

## 2026-09-21 — Imported Usenet conversations join legacy threads by Message-ID; legacy slugs are never recomputed

**Why:** the point of the extra groups is context around posts the site already has. Per-source JWZ (subject merge never crosses a community), then union by shared canonical ids and cross-source References; a conversation that contains a Message-ID already in the show's DB appends to that thread and links the existing message as an additional membership. New threads get `import_key = c:<16 hex>` and the standard content-hash slug; a joined legacy thread keeps its slug even when an earlier message arrives, so shared links survive.
**Rejected:** recomputing slugs from the new earliest message (breaks every shared link); importing crossposts as separate messages (double-counts reactions); subject-based merging across communities (unrelated 2012 rec.arts.tv threads would fold into 1990s ones).

## 2026-09-21 — Relevance is a deterministic screen with an explicit disposition per (record, show); Jev is unavailable

**Why:** TypeSafe returned 402 (no credits) on probe, so nothing new could be classified. The screen is explainable: posts in a show's own group (`community`), posts distributed to the show's group (`crosspost`), show name or episode title in the subject, or ≥2 unquoted body mentions (or 1 + an episode term) are accepted; one unquoted mention is `needs_review`; quoted-only mentions and spam are excluded; every other member of an accepted conversation is `context`, imported for completeness but never counted as an independent match. Seeds from the research audit all receive a row (a seed with no decoded mention is `no_mention`). Episode attribution for new threads is the legacy heuristic plus one addition: a thread that started within ~1.7 days of exactly one air date is attributed to it at confidence 45.
**Rejected:** auto-accepting the 10,466 research candidates (339 Seinfeld ones are mostly incidental); running 389k records through paid classification; leaving new threads unattributed until credits exist (the pilot-week Family Guy threads would be invisible).

## 2026-09-21 — Capsules are metadata-only; forum originals are offline, so the Archived copy is the replay

**Why:** every Simpsons Archive capsule carries "Not to be redistributed in a public forum without permission", so the source is `metadata_only`: 41,292 extracted contributions are cataloged locally (kind, attribution as printed, span) and the site shows only document metadata, counts and the original document link. The South Park forum permalinks return 404 (probed 2026-09-21); each post links a Wayback replay of its captured page at the WARC capture timestamp ("Archived copy"), the Archive Team item ("Archive collection") and our preserved-record view. Usenet posts have no permalink: "Browse source" (Google Groups) and "Archive collection" only.
**Rejected:** publishing capsule review text (license); labeling a WARC download as a readable post; presenting the 2024 capture time as a post date (original minute-precision UTC times are kept separately).

## 2026-09-21 — Per-post timing is computed at read time; a forum topic is live if any post is

**Why:** official episode topics open with a blurb two days before air and run for months, so thread-start timing would label them retro and their later replies as premiere reactions. `threads.get` derives `before` / `live` / `later` / `unknown` per message against the primary episode on ET calendar days and the UI tags posts whose timing disagrees with the thread relation ("before it aired", "later reply", "date inherited"). The relation of a native forum topic is `live` when at least one post falls in the live window. Inherited (JWZ-resolved) dates are stored as `date_precision = unknown` so they are never shown as observed times.
**Rejected:** per-post relation rows (episode counters are thread-based and the UI reads threads); splitting long topics into per-window threads (destroys native order).

## 2026-09-21 — New research stays in source-aware files before app ingestion

**Why:** owner requested a source on all collected content and explicitly chose organizing files before changing the database. Separate original community (`sourceId`), source-native content identity, captured artifact/observation, and many-to-many show associations. Usenet crossposts share canonical Message-ID identity while retaining each group occurrence; forum post IDs deduplicate pagination; capsules remain compiled documents with unknown contributor timestamps. Keep original posting, capture, retrieval and verification dates distinct. Raw and normalized bodies stay in gitignored `data/archives/research-2026-09-21/`; scripts and metadata inventories are tracked. See `plans/2026-09-21-source-aware-collection.md`.
**Rejected:** one show-owned archive per new source (shared groups could be reassigned/purged by the current loader); one free-text source label with no artifact evidence; fabricated dates/threads for capsules; dropping duplicate captures before recording provenance. App schema and production data remain unchanged pending a separate integration.

## 2026-09-21 — Prod hosting: drydock at tv-rewind.dested.com, data by pg_dump/restore

**Why:** self-hosted drydock (one ARM EC2 box, shared Postgres 17, Caddy auto-TLS, GitHub Actions CI) already runs the fleet; onboarding is one `projects.create`. Project named `tv-rewind` (→ db `tv_rewind`, domain defaults to `tv-rewind.dested.com`). Pre-deploy is **`bun run db:deploy`**, never the auto-detected `prisma db push` — db push can't see the `message_search_update()` tsvector trigger and would drift (hard rule #6). The archive DB is static and offline-built, so instead of re-running the pipeline in prod we shipped the local DB up whole: `pg_dump -Fc` → `pg_restore` into the freshly-created empty db over the box's temporarily-open 5432. The dump's `_prisma_migrations` makes every future pre-deploy a no-op until a new migration lands.
**Rejected:** re-running the ingest/classify/enrich pipeline against prod (costs money, needs the archives + LLM credits on the box); `prisma db push` as pre-deploy (drift, forbidden); a data-only dump (FK ordering + trigger-refire needs superuser we don't have on the shared server — a full dump orders triggers post-data and needs none).

## 2026-09-20 — Product: Usenet reaction archive aligned to episode air dates

**Why:** the interesting unit isn't "a thread" but "what the newsgroup said the morning after an episode aired". Everything hangs off `Episode`; threads attach via `ThreadEpisode` tagged live (started within `Show.liveWindowDays` after air) or retro.
**Rejected:** a plain mbox/thread viewer (built briefly, then replaced by this); grouping by subject only.

## 2026-09-20 — Generic from day one; one registry, one command per show

**Why:** ~23 alt.tv.\* archives exist on archive.org (`usenet-alt/<group>.mbox.zip`). `data/shows.json` is the registry, `bun run pipeline add-show <group> --name "<Show>"` downloads, resolves TVMaze, registers, and ingests. Per-show curation lives in `data/shows/<slug>/{aliases,phrases}.json`.
**Rejected:** hardcoding Seinfeld; per-show code paths.

## 2026-09-20 — Episode data from TVMaze, cached in-repo

**Why:** free, no key, every episode has `airdate`/`airstamp`/summary/still/rating. Snapshot committed as `data/shows/<slug>/episodes.json` so builds are reproducible and offline.
**Rejected:** IMDb bulk datasets (no air dates, no API); Wikipedia scraping.

## 2026-09-20 — Episode attribution: heuristics score candidates, Haiku 4.5 adjudicates, everything audited

**Why:** nobody in 1996 wrote "S07E24". Air-date window + title/alias matching + summary overlap produce candidates; one Message-Batches call per qualifying thread (opener + ≤3 early replies, full episode list cached in the system prompt) returns episode + confidence AND kind / sentiment / hotTake / pullQuote / prediction claim+outcome — one call, many features. Every `ThreadEpisode` stores `method` + `confidence`; an admin procedure can override with `method: 'manual'`.
**Rejected:** heuristics only (too many misfires on generic titles like "The Deal"); LLM-only without hints (cost, drift); per-thread live API calls (batches are 50% cheaper and rate-limit-free).

## 2026-09-20 — Per-episode recap written by Opus 5, thread classification by Haiku 4.5

**Why:** classification is high-volume, low-difficulty → Haiku via batches. The recap is 180 calls of actual prose → Opus 5 at low effort. Model ids live on `Thread.classifyModel` / `Episode.recapModel` so a re-run with a newer model is traceable.

## 2026-09-21 — Classification moved to Jev (TypeSafe AI); Haiku only enriches — supersedes the two entries above

**Why:** the owner asked for Jev. One `systemOne` call per thread answers episode / kind / sentiment / hot-take / spam / pull-quote as calibrated `choice`/`noul` questions with probabilities, at $0.042/M input and no output cost — ~$10 for all 33k Seinfeld threads, 18 req/s, no batching wait. Jev cannot generate text, so the free-text pieces (one-line summary, prediction claim + graded outcome) stay on Haiku 4.5 Message Batches for the ~⅓ of threads that qualify; recaps stay on Opus 5. Contract: `pipeline/lib/jev.ts` folds answers through `Classification.parse`; confidences are stored as 0–100.
**Rejected:** Haiku for everything (5–10× the cost for the high-volume part, and no calibrated probabilities); Jev for summaries (can't).

## 2026-09-21 — Shows over Jev's 255-label cap get a per-thread episode roster

**Why:** The Simpsons has 803 episodes, King of the Hill 279; a `choice` takes ≤255 labels. For those shows the roster is the attribute stage's candidates (title/alias/window matches) first, then the most recently aired episodes before the thread started, filled to 254. Retro threads about an old episode still reach it through a title/alias candidate. Shows under the cap see the full list.
**Rejected:** two-step choice (season, then episode — doubles calls and loses cross-season probabilities); dropping the episode question for big shows.

## 2026-09-21 — Date-only headers are a first-class state; reaction analysis is per ET calendar day

**Why:** 61% of Seinfeld-era `Date:` headers are `YYYY/MM/DD` with no clock. They parse to noon UTC deterministically with `dateOnly: true` on the message and `startedDateOnly` on the thread; the UI never shows a clock or an hour phrase for them (`formatDateTime(iso, dateOnly)`, `relativeToAir(hours, days, postedAt)`), and `reactionByDay` (−1..+14) replaced the hourly curve everywhere. Live/retro is decided on calendar days in `America/New_York`.
**Rejected:** treating date-only as midnight local (produced a fake "7 hours before it aired" for half the archive); dropping those messages.

## 2026-09-20 — Poster identity: display name only, email never stored

**Why:** the site is public and indexable; the addresses are 30 years old. `Poster.key` is a sha256 prefix of the lowercased address so identity survives across archives (the same person on alt.tv.seinfeld and alt.tv.frasier is one poster), but the address itself is never persisted or rendered.
**Rejected:** full `From:` as archived; pseudonyms (kills the "Kenny Kramer posted here" story).

## 2026-09-20 — Threading: JWZ with References/In-Reply-To, subject-merge only within 30 days

**Why:** 77% of messages carry `References`, so real reply trees are available. Subject-based merging rescues broken chains but must be window-limited — "kramer" has 230 posts over 20 years and must not collapse into one thread.

## 2026-09-20 — Full-text search: Postgres tsvector maintained by trigger, GIN index; migrations only

**Why:** 216MB of text doesn't need Elasticsearch. A GENERATED column was the first choice but Prisma migrate can't represent one and tried to drop it on every diff; a `BEFORE INSERT/UPDATE` trigger is invisible to Prisma. Consequence: **never `prisma db push` here** — it can't see the trigger; use `bun run db:migrate` / `db:deploy` only (the `db:push` script was removed).

## 2026-09-20 — Bulk load with raw `pg` unnest inserts; Prisma for reads

**Why:** 157k messages per archive; batched `INSERT … SELECT FROM unnest(...)` loads in seconds without a COPY dependency. tRPC procedures use Prisma except where FTS/`ts_headline`/aggregations need raw SQL.

## 2026-09-21 — One light paper theme; dark mode removed — supersedes the 2026-09-11 dark-mode entry

**Why:** the owner rejected the brutalist/dark look and asked for a single committed design ("no color changing, make it light. pick a design"). `ui.md` v3 is that design: cream paper, warm ink, red-orange `--brand`, print-blue `--link`, Newsreader + Inter, ruled rows instead of cards, flat transcript threads. `theme.ts`, `theme-toggle.tsx`, the pre-paint script and every `dark:` variant are gone; `color-scheme: light` is declared so form controls match.

## 2026-09-21 — Thread URLs are content-hash slugs, not DB ids

**Why:** `load --force` deletes and re-inserts a show's threads, so ids change on every reload and every shared link died. `Thread.slug` = first 12 hex of `sha256("<show slug>:<earliest message's Message-ID>")`, unique per show, computed by the loader after messages land (provisional `~<threadKey>` before that) and backfilled by migration `20260921060000_thread_slug`. `threads.get` takes `{show, slug}`.
**Rejected:** slugifying the subject (collides constantly on "Re: last night's episode"); keeping ids and adding a redirect table (still breaks on the first reload before the table exists).

## 2026-09-20 — Dev port 7485, plain localhost, sign-up closed

**Why:** owner rule: never 3000; portless only when an https origin is needed (it isn't — single app, no OAuth). better-auth stays only for the admin attribution-fixer; `ALLOW_SIGNUP=true` once to create the account, then off.

## 2026-09-20 — Charts are hand-rolled SVG; emoji allowed only as category glyphs

**Why:** three simple single-series charts don't justify a chart library, and SSR/hydration parity is easier to guarantee by hand. The owner asked for emoji category tabs (🔥 😂 😡 🤯 🧠), so `ui.md`'s no-emoji rule has exactly that exception, centralized in `src/lib/taxonomy.ts`.

## 2026-09-11 — Stylesheet is a `<link>` in `index.html`, not a JS import

**Why:** importing `app.css` from `App.tsx` made Vite inject it after the client module graph loaded, so every dev load painted unstyled SSR HTML first. A head `<link>` is render-blocking in dev (Vite serves compiled CSS, HMR swaps the href) and gets hashed into `<head>` by `vite build`. Zero server code.
**Rejected:** collecting CSS from `vite.moduleGraph` in `server.ts` and inlining `<style data-vite-dev-id>` (works, but ~30 lines of dev-only plumbing for the same result).

## 2026-09-11 — Dark mode: `.dark` class + inline pre-paint script + `dark:` markup swaps

**Why:** the tokens already existed under `.dark`; an inline `<head>` script (stored choice → `prefers-color-scheme`) applies the class before first paint, and components render both variants and hide one with `dark:` so SSR and client markup are identical. Binary toggle persisted in `localStorage.theme`; absence means "follow the OS" (tracked live by `followSystemTheme`).
**Rejected:** media-query-only dark mode (no user override); React state / context for the theme (hydration mismatch or a post-mount icon flip); a system/light/dark tri-state (needs a dropdown → radix Slot dependency the template deliberately avoids).

## 2026-09-11 — Vite HMR websocket shares the Express `http.Server`

**Why:** the fixed `hmr.port: 24678` collided whenever two clones of this template ran at once (HMR silently connected to the wrong server and got a 400). `hmr: { server }` means one port, and it survives reverse proxies.
**Rejected:** `PORT + 1` (still a second port; breaks behind proxies), `hmr.port: 0` (Vite does not pick a free port in middleware mode).

## 2026-09-11 — Client-nav loaders prefetch through lazy browser singletons

**Why:** `getBrowserClients()` in `src/lib/trpc.tsx` gives loaders the same `QueryClient` + tRPC options proxy the app renders with, so `dashboardLoader` can `await prefetchQuery` on client navigation — no "Loading…" flash. Lazy so the shared `routes.tsx` allocates nothing during SSR.
**Rejected:** fire-and-forget prefetch (still flickers), creating the clients in `routes.tsx` at module scope (runs on the server too).
