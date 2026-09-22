# Source integration: implementation decisions and run log

- **Date:** 2026-09-21
- **Status:** done
- **Type:** plan
- **What:** The settled design for executing `2026-09-21-fable-source-integration-handoff.md` (catalog → additive schema → resumable import → source-location UI), plus the run report once the local import has executed.

## Architecture (decided)

**Two layers.** The *catalog* (`source`, `artifact`, `source_record`, `observation`, `record_show`, `contribution`) is independent of show ownership and holds every collected record with provenance and a reviewed disposition per show. The *serving projection* stays `archive` → `thread` → `message`; new posts become messages, linked back through `message.source_record_id` (primary) and `message_source` (all memberships). Legacy messages keep their community through `archive.source` (nine legacy `source` rows backfilled by migration `20260921200000_sources`).

**Ownership.** `archive` becomes one row per *(show, community)* (`@@unique([showId, newsgroup])` replaces the global newsgroup uniqueness). A shared community (rec.arts.animation) feeds several shows through several archive rows; no reassignment, no purge of another show's data. The legacy loader upserts `ON CONFLICT (show_id, newsgroup)` and only ever deletes its own archive's threads.

**Identity.** Collection ids are authoritative: `recordId = sha256(sourceId:externalId)`, `canonicalId` per the organized bundle. Within a show a canonical post is projected once; crossposts seen in two sources are one message with two `message_source` rows. Legacy Message-IDs already in a show's DB are *linked* (additional membership), never re-inserted.

**Threads.** Usenet: per-source JWZ (subject merge never crosses a source), then conversations unioned across sources by shared canonical ids and References that resolve into another thread. A conversation that shares a Message-ID with an existing legacy thread joins that thread (messages appended; slug untouched). New threads get `import_key = c:<16 hex>` and the standard content-hash slug. Forum: native topic = thread (`import_key = forum:<source>:<topic>`), post order by native time, no synthesized reply edges. Capsules: never threads or messages — documents with extracted contributions, `metadata_only`.

**Relevance.** Deterministic screen, one disposition row per (record, show): `community` (posts in a show's own group), `crosspost` (distributed to the show's group), `subject-term`, `subject-episode`, `body-term` → accepted; single unquoted mention → needs_review; quoted-only mention → excluded; spam → excluded; members of an accepted conversation → context (imported for completeness, never counted as an independent match). Seeds from `show-associations.jsonl` are all evaluated; a seed with no decoded mention is excluded `no_mention`.

**Timing.** Thread relation (live/retro) on ET calendar days (`pipeline/lib/timing.ts`, now also used by the legacy loader). Per-post timing (`before` / `live` / `later` / `unknown`) is computed at read time against the thread's primary episode and shown when it disagrees with the thread relation, so later replies in a premiere thread are never labeled premiere reactions. Day-only and inherited dates keep their precision (`message.date_precision`).

**Publication.** Every capsule carries a "not to be redistributed" notice → source `metadata_only`: the app shows document metadata, contribution counts and the original document link; contribution text is cataloged locally and never served. Forum originals are offline (404 probed 2026-09-21); each post links an Archived copy (Wayback replay of the captured page at the capture timestamp) and the Archive Team collection, plus our preserved-record view. Usenet posts have no per-post permalink: "Browse source" (Google Groups) and "Archive collection" (archive.org) only.

**Routes.** `/sources`, `/sources/:key`, `/sources/:key/records/:recordId`, `/:show/sources`; static siblings registered before the dynamic segments.

## Commands

```
bun run pipeline sources catalog [--source a,b] [--dry-run]     # inventory + screen + conversations + capsule extraction
bun run pipeline sources import <show> [--dry-run] [--force]    # projection for one show, then stats
bun run pipeline sources report                                  # counts → data/work/sources/report.json
```

## Run log (2026-09-21, local DB `alt_tv_rewind`)

Commands, in order (each idempotent; a second `import` inserts nothing):

```
bun run db:deploy                                   # 20260921200000_sources (+ legacy source backfill)
bun run pipeline sources catalog                    # all seven sources (~20 min; 388,353 records)
bun run pipeline sources import family-guy          # then south-park, simpsons, seinfeld
bun run pipeline sources report                     # → data/work/sources/report.json (snapshot: plans/2026-09-21-source-catalog-report.json)
```

Pre-migration baseline: 9 shows, 9 archives, 112,913 threads, 665,499 messages, 84,490 posters, 22,495 thread_episode. After: legacy 665,499 messages / 112,913 threads unchanged (verified by `source.legacy` join); all rows added carry `import_key` / `source_record_id`.

| Show | In scope (accepted+context) | Conversations (new / joined legacy) | Messages inserted / linked | thread_episode (heuristic) | Needs review |
| --- | ---: | ---: | ---: | ---: | ---: |
| family-guy | 5,663 | 394 / 397 | 4,387 / 1,270 | 58 (53 live) | 396 |
| south-park | 7,842 (1,324 forum) | 231 / 78 + 4 topics | 6,004 + 1,324 / 511 | 27 + 4 official-topic | 648 |
| simpsons | 29,552 (+281 documents) | 3,577 / 493 | 27,902 / 1,612 | 406 (381 live) | 374 + 3 capsules |
| seinfeld | 3,334 | 67 / 15 | 3,245 / 88 | 14 (0 live; 61 in-era accepted) | 232 |

Catalog totals: 7 sources; 388,353 records; 391,755 observations (6 differing body versions in rec.arts.tv, 2 forum pagination duplicates); 2,675 missing-ID Usenet records kept with `raw-sha256` identity; 167 bodies over the legacy 65,536 cap kept whole; 3,026 undated Usenet records have no conversation and stay `needs_review: undated`. Spam excluded per show: 11,828. Seeds: all 10,466 candidate memberships evaluated (719 Simpsons seeds had no decoded mention → `no_mention`).

Acceptance evidence (local URLs): `/family-guy/s01e01-death-has-a-shadow` (3 live threads from rec.arts.animation, 1999-02-01/02), `/family-guy/thread/2260b8374328` ("Family Guy Reactions"), `/south-park/thread/d061535ee5cc` (topic 15576, 210 posts, 24 tagged "before it aired", 5 "later reply"), `/sources/southpark-official-forum/records/a2c3bd210f8df360b325a519fd25c99391e1ff9e3b769ee38465584002f7f43b` (post 357190: 2005-11-28 19:45 UTC minute precision, capture 2024-01-10 02:45:13 UTC, edit 19:48, Original post offline, Archived copy → Wayback, Archive collection), `/sources/simpsons-archive-capsules` (281 documents, 2F09 → S06E12 by airdate 8-Jan-95 with revision 22-Feb-97 kept as text, 9F10 → S04E12 by title with its 1994 conversion date never used as a posting date), `/simpsons/s06e12-homer-the-great` (capsule line), `/sources`, `/family-guy/sources`.

Dependencies left open: TypeSafe (Jev) returned 402 — new threads are heuristic-attributed (3,171 of 3,577 new Simpsons threads have no episode; they remain reachable through search, people and the source pages). Anthropic enrich/recap not run. Production still runs the pre-integration database; deploying needs a fresh `pg_dump`/`pg_restore` (the catalog adds ~1.4 GB) plus `bun run db:deploy`.
