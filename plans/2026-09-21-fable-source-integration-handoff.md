# Fable handoff: catalog the collected discourse and integrate it into alt.tv.rewind

- **Date:** 2026-09-21
- **Status:** done
- **Type:** plan
- **What:** Completed handoff specification; cataloging, application integration and publication described below are not yet implemented.

## Task to execute

Take the already-collected discourse for **Family Guy, The Simpsons, South Park and Seinfeld**, finish cataloging it, and integrate the usable material into the existing application. Prioritize original 1990s–2000s reactions. Readers must be able to see **where each item originally appeared** and follow a real source-location link or an accurately labeled archive fallback.

Own the work end to end: cataloging, extraction, relevance/spam review, episode attribution, provenance, schema migrations, resumable import, API/UI changes, statistics/search integration and verification. Do not stop after designing a schema, printing a plan, or exposing an unreviewed data dump. Run the local import and demonstrate the result. Report actual accepted/excluded/unresolved counts and remaining gaps rather than treating every candidate as a recovered premiere reaction.

The owner explicitly asked for cataloging too. Earlier they chose **organize collected files first**, which has been completed. This document is the next implementation handoff; writing it did not change the database. Follow the receiving session's instructions for production deployment and paid services; this file does not assert either has already been authorized or performed.

Work in `G:\code\alt-tv-rewind`. The repository uses Bun, Express, React Router, tRPC, Prisma and PostgreSQL. Dev URL: `http://localhost:7485`; production location recorded in the doc kit: `https://tv-rewind.dested.com`. Read `cliffnotes.md`, `ui.md` and `decisions.md` first. Inspect current git status and preserve existing changes. This handoff was written while research files and doc-kit edits were uncommitted.

## What exists now

| Show | New screened Usenet candidates | Other collected content | Value / limitation |
| --- | ---: | --- | --- |
| Family Guy | 1,467 | — | Includes `Family Guy Reactions`, February 1, 1999, the morning after the pilot; existing main-group checkpoint starts May 9, 1999 |
| The Simpsons | 6,658 | 281 compiled capsule documents | Satellite Usenet group reaches 1992; existing main-group checkpoint has zero 1990s posts |
| South Park | 2,002 | 1,324 unique official-forum posts across four episode topics | Native IDs and UTC posting times recovered from 91 archived pages |
| Seinfeld | 339 | Existing main-group archive remains the strongest source | Only two new candidates matched in the subject; most are incidental body mentions; 1989–1991 remains missing |

These are **10,466 show memberships across 9,426 distinct Usenet candidates**, not verified episode reactions. They exclude Message-IDs already present in the corresponding existing show checkpoint. They do not include complete reply chains, and the initial body search did not MIME-decode. Do not make this keyword subset the only import input.

The normalized collection contains **7 sources, 388,353 source records, 391,362 observations and 387,529 canonical identities**. This larger corpus includes unrelated posts, spam and dates after 2009. It is the full retained source material, not a count of new relevant posts.

| Source ID | Distinct source records | Raw observations |
| --- | ---: | ---: |
| `usenet-rec-arts-tv` | 173,216 | 173,391 |
| `usenet-rec-arts-animation` | 129,714 | 132,443 |
| `usenet-alt-tv-game-shows` | 77,566 | 77,660 |
| `usenet-alt-tv-familyguy` | 852 | 852 |
| `usenet-alt-tv-simpsons-itchy-scratchy` | 5,400 | 5,409 |
| `southpark-official-forum` | 1,324 | 1,326 |
| `simpsons-archive-capsules` | 281 | 281 |

Do not confuse `alt.tv.familyguy` with the existing `alt.tv.family-guy`: two communities, one show. Most `rec.arts.tv` material is from 2012–2013, so it does not fill early Seinfeld's gap. The forum topics are Free Willzyx (`15576`), Bloody Mary (`15753`), Smug Alert! (`18874`) and Cartoon Wars Part II (`19318`); some replies are much later than first broadcast.

## Required inputs and how to find them

All paths below are repository-relative. The agent needs this workspace, not just the text of this handoff. **Raw and normalized content is gitignored and will not arrive with a fresh git clone.** If working elsewhere, transfer the existing research directory and relevant legacy checkpoints, or recreate them with the scripts below. Do not say the corpus is available merely because its inventory JSON is present.

| Path | Purpose |
| --- | --- |
| `data/archives/research-2026-09-21/organized/sources.json` | Seven source definitions and measured coverage |
| `data/archives/research-2026-09-21/organized/artifacts.jsonl` | Raw file identity, checksum and collection/download evidence |
| `data/archives/research-2026-09-21/organized/sources/<sourceId>/records.jsonl` | Source-specific normalized content |
| `data/archives/research-2026-09-21/organized/sources/<sourceId>/observations.jsonl` | Every recovered occurrence, raw file locator and version evidence |
| `data/archives/research-2026-09-21/organized/show-associations.jsonl` | Initial candidates/context associations; episode IDs are still null |
| `data/archives/research-2026-09-21/organized/summary.json` | Aggregate validation result |
| `data/archives/research-2026-09-21/` | Immutable originals: five mboxes, ZIPs, capsule files, South Park WARC records, CDX indexes, manifests |
| `data/work/<show>/messages.jsonl` | Existing parsed show records used for prior deduplication; other checkpoints contain existing threading/classification/enrichment |
| `data/shows.json`, `data/shows/<show>/episodes.json` | Existing show identities and cached TVMaze episodes |
| `plans/2026-09-21-original-discourse-research.md` | Detailed research, actual source URLs, coverage holes and access limitations |
| `plans/2026-09-21-source-aware-collection.md` | Implemented JSONL contract and verification details |
| `plans/2026-09-21-{usenet,forum,capsule}-provenance.md` | Three separate source reviews; interpret this shorthand as three filenames |
| `plans/2026-09-21-discourse-inventory.json` | Original research measurements and download evidence |
| `plans/2026-09-21-organized-discourse-inventory.json` | Normalized metadata snapshot without content bodies |

Validate the existing organized files first:

```powershell
python plans/2026-09-21-organize-discourse.py --adapter none
```

Rebuild organized files from retained originals only when needed:

```powershell
python plans/2026-09-21-organize-discourse.py
```

If originals actually need reconstruction:

```powershell
python plans/2026-09-21-collect-discourse.py
python plans/2026-09-21-audit-discourse.py
python plans/2026-09-21-organize-discourse.py
```

Run sequentially. The audit needs the four legacy `messages.jsonl` checkpoints. The collector currently reports a known HTTP 404 for capsule `7F76.html` (a music-video entry), retaining the other 281 successes. Handle this recorded partial failure explicitly rather than discarding the whole collection or claiming 282 downloads. The organizer's fixed-count assertions describe this dated snapshot; put later expanded collections in a new version/run instead of silently changing historical totals.

## Workstream 1 — Finish cataloging before publication

Build a durable, queryable catalog and a machine-readable completion report. Implement the cataloging; do not simply restate these requirements as future work.

1. **Inventory all seven sources and all normalized records.** Store source type/name/homepage/aliases, artifact hashes, actual date coverage and precision, capture evidence, topic/document identities and extraction status. Preserve raw originals. Catalog the older app sources as legacy sources too; do not fabricate missing historical download or capture timestamps.
2. **Rescreen the usable era from decoded content.** Use the full normalized sources, show names, episode titles/aliases/production codes and conversation context. Seed from existing candidate associations, but recover relevant posts the broad title-only screen missed. Preserve other-era records in the collection, outside default premiere-era presentation.
3. **Restore conversation context.** Follow Usenet References/In-Reply-To to parents/replies in the retained sources and existing corpus. Keep missing-parent evidence. Preserve native forum topic IDs and post order; do not invent reply edges from quotations or adjacency. Label context-only replies so they do not become independent episode matches by accident.
4. **Review relevance and spam.** Give each evaluated show/content association an explicit disposition: accepted, excluded, or needs review, with method, evidence, confidence where applicable and a reason. Distinguish quoted mentions, incidental mentions, actual discussion, spam and unknown. Do not auto-accept all 339 Seinfeld candidates or silently drop difficult cases.
5. **Assign shows and episodes.** Use existing show slugs and episode IDs. Retain multiple relevant shows/episodes where supported. Record attribution method, evidence and confidence; create a review queue/export for ambiguous mappings. Avoid assigning all posts in a long forum topic to premiere timing based on its opening date.
6. **Catalog capsules at both levels.** All 281 documents need document metadata and an episode/special/unresolved mapping. Extract identifiable contributor reviews/observations with printed attribution, section identity and exact normalized-text spans/raw artifact provenance; support the different actual layouts rather than one universal `Reviews` heading. Separate script quotations, summaries and aggregate grades from opinions. If a layout is unrecognized, retain the document with an explicit extraction disposition. No invented author identities, conversations or posting dates.
7. **Resolve duplicates and versions.** Reconcile against legacy Message-IDs, across collected groups, and across repeated forum captures. Preserve all observations, the six known differing Usenet body versions, and uncertainty. Capsule contributions that reproduce original posts need an evidenced relationship, not automatic same-author or loose-text merging.
8. **Produce reconciled counts.** Report source totals, in-era candidates, recovered context, accepted unique posts, existing-post evidence additions, excluded/spam, unresolved, attributed episodes, undated contributions and public import totals by show/source. Count memberships separately from canonical posts and documents separately from contributions. Every candidate must be accounted for; every source record must have inventory/extraction status even when it was not a relevance candidate.

Use deterministic processing first and the existing classification infrastructure where suitable. Inspect current service availability; prior docs report exhausted credits. Run supported dry-run/cost estimates before large paid batches. If a service is unavailable, complete deterministic cataloging/import of verified material, retain unresolved classifications honestly, and report the exact dependency. Do not invent results or run the whole unrelated 389k-record corpus through paid classification.

## Workstream 2 — Storage and migrations

Choose concrete schema names after inspecting the current code, but preserve these separate concepts:

| Concept | Required behavior |
| --- | --- |
| Source/community | Independent of show ownership; one community can discuss many shows |
| Raw artifact | Immutable bytes/hash, format, custodian/download location; an artifact may support multiple sources |
| Canonical content | Global identity where evidence supports it; type distinguishes post/document/contribution |
| Source record | Original/native identity and community occurrence of canonical content |
| Observation/version | Every artifact occurrence, locator, observed hash/body version, capture and retrieval evidence |
| Show/episode association | Many-to-many relevance, classification status, evidence, confidence and timing |
| Serving projection | Existing/new app messages and threads linked to canonical/source content; preserves legacy URLs and classifications |

The implemented collection contract is authoritative for import identity:

- `recordId = sha256(sourceId + ':' + externalId)`.
- Usenet `canonicalId = 'usenet:' + sha256(externalId)`, retaining exact-case original bracketed Message-ID. Missing-ID `externalId` is `'sha256:' + rawHash`; keep its synthetic identity method explicit.
- Forum `canonicalId = 'forum:' + sourceId + ':' + nativePostId`.
- Capsule `canonicalId = 'document:' + sourceId + ':' + filename`.
- An earlier conceptual audit describes a different hash concatenation; do **not** substitute that for the implemented JSONL IDs.

Keep raw date text, nullable original instant, original date, precision, timezone and derivation. Day-only records have no observed clock. Unknown-zone clocks have no justified UTC instant. Retain capture, revision, edit, retrieval and verification times separately. A chosen sorting timestamp is not an original posting timestamp.

Migrate additively and backfill legacy source identities/projection links. Capture pre-migration counts and representative existing URLs. Use Prisma migrations, never `db push` or a production reset. Preserve FTS trigger/index behavior. Keep public serialization separate from raw headers, internal file paths and email addresses.

## Workstream 3 — Safe, resumable import

Implement an explicit source-aware catalog/import command with dry-run, source/show filtering, resume/checkpoints, an input checksum/schema/extractor-version fingerprint and an import summary. Document its actual invocation after implementing it. Reject stale incompatible checkpoints instead of reusing classifications by row position.

Start with Family Guy's verified 1999 pilot-era material, then the four South Park topics, then Simpsons Usenet/capsule material, then accepted Seinfeld additions. This is an order of execution, not permission to omit the later shows.

For posts already in the app, attach source observations and associations without duplicating the displayed post or rerunning paid classification unnecessarily. For new relevant posts, build/extend conversations and run supported attribution/classification stages. Recompute affected search/statistics/episode views. A shared-source import for one show must not remove the other show's data. Import reruns must not increase logical post or reaction counts.

Keep capsule compilations distinct from post transcripts. Respect their current `publicationStatus: local_research_only` and embedded redistribution notices: catalog their content locally and provide episode-linked public metadata/source-location links. Do not publish full compiled bodies merely because they were downloaded. Eligible extracted contributions need their own explicit publication disposition; do not treat the capsule's license/status as unknown by dropping it.

Known legacy hazards to address at the point of integration:

- `Archive.newsgroup` is globally unique while `Archive.showId` is singular. `load.ts` reassigns ownership and deletes that archive's threads on reload. Shared groups cannot be loaded by pretending each belongs exclusively to another show.
- JWZ takes the first duplicate Message-ID and discards later observations. Provenance must be retained before that step.
- Stage keys such as `t0` change when inputs expand. Reusing old classification/enrichment checkpoints can apply results to the wrong conversation.
- Existing public slugs hash the earliest message ID; discovering an earlier message changes that expression. Preserve existing slugs and add aliases when necessary; do not break links by recomputing them blindly.
- Subject merging is not source-aware. Preserve Usenet references across groups where evidenced, but avoid combining unrelated communities or native forum threads by subject alone.
- The old parser drops missing-ID messages and caps bodies at 65,536 characters. The collection retains 2,675 missing-ID records and 245 longer bodies. Explicitly account for these rather than silently losing them.
- The current loader's timing calculation and documented ET calendar-day rule need reconciliation. Test actual behavior; do not assume documentation proves correct implementation.
- Legacy poster email hashes and source-scoped forum accounts are different identities. Matching display names alone is insufficient to merge them.

## Workstream 4 — Source location in the app

The user means **the location/community where content appeared**, not a link to this research document and not a raw filesystem path.

Required reader-facing behavior:

1. Every displayed imported post/contribution has a compact source label near its author/date, e.g. `rec.arts.animation` or `South Park Forums`. For legacy posts, show the backfilled original newsgroup. Mixed-source threads identify the source per post.
2. Provide **Original post** only when a specific original permalink is known. Keep dead original locations as provenance, with an accurately labeled archived/local-preserved alternative. A group homepage is **Browse source**, not **Original post**.
3. An exact usable replay/preserved-record view can be labeled **Archived copy**. An Internet Archive item listing alone is **Archive collection**; do not pretend a multi-gigabyte WARC download is a readable post permalink. For saved WARC-only pages, implement a stable read-only preserved-record view from the normalized evidence, linking its collection and capture information. Render sanitized text through the app's presentation/redaction rules, not raw archived HTML/scripts.
4. If a post has several sources/captures, show a compact primary source plus access to **All sources**. Preserve primary-selection reasoning without hiding alternate evidence. Multiple captures must not look like multiple reactions.
5. Episode and search/thread listings expose source names; add a source filter where lists combine communities. Thread-level source information may be an aggregate, but must not replace each post's source attribution.
6. Provide a show source catalog listing communities, actual available coverage, accepted imported counts and incomplete coverage notes. Capsules are clearly labeled compiled material with separately dated/undated contributions; distinguish collected documents from public posts.
7. Keep storage hashes/byte offsets/internal paths in the diagnostic/catalog layer. Reader metadata should answer who/where/when and provide working links. Unknown original dates display as unknown; a 2024 capture does not become the displayed date of a 2005 post.

Suggested routes, to finalize in the implementation: `/:show/sources` for the show catalog, `/sources/:sourceId` for a source, and `/sources/:sourceId/records/:recordId` for a stable preserved-record location where justified. Register static/reserved routes before `/:show/:episode`, and verify no existing episode route is shadowed. A source-record view must respect publication/relevance status; do not accidentally publish every unrelated raw archive record.

Follow `ui.md`: existing cream paper theme, Newsreader/Inter, print-blue links, muted metadata, ruled rows; retain Transcript and Reply chains. No redesign is needed.

## Workstream 5 — Timing, counting and search

- Determine original-era timing per post/contribution, not solely from thread start. Keep pre-air anticipation, first-US-air window, evidenced first-regional-air response, later/repeat discussion and unknown timing distinguishable. A later reply in an old thread is still later.
- Use the existing show's configured live window for the compatible US view, with correct calendar-day treatment and explicit date precision. Do not invent regional air dates; preserve documented region/evidence and mark unresolved timing honestly.
- Undated capsule contributions are searchable/contextual only where eligible; they must not inflate dated reaction charts or premiere-window sentiment totals.
- Deduplicate reaction counts by canonical identity within a show/episode while retaining source memberships. Distinguish post counts, contributors, documents, extracted contributions and captures.
- Preserve source metadata on search hits and pull quotes. Retain quote boundaries so quoted/capsule script material is not analyzed as another person's independent opinion. Update FTS/redaction behavior and statistics consistently for each supported content kind.

## Implementation map

| Area | Existing files to inspect |
| --- | --- |
| Schema / migrations | `prisma/schema.prisma`, `prisma/migrations/`, `prisma.config.ts` |
| Registry / stage contracts | `data/shows.json`, `pipeline/lib/types.ts`, `context.ts`, `checkpoint.ts`, `pipeline/cli.ts` |
| Parsing / threading | `pipeline/stages/parse.ts`, `thread.ts`, `pipeline/lib/{mbox,mime,normalize,jwz}.ts` |
| Attribution / classification | `pipeline/stages/{attribute,classify,enrich}.ts`, `pipeline/lib/{episode-index,scoring,jev,thread-text}.ts` |
| Load / statistics | `pipeline/stages/load.ts`, `stats.ts`, `pipeline/lib/db.ts` |
| API / search | `server/routers/{threads,episodes,shows,search,posters,shared}.ts`, `server/router.ts` |
| UI / formatting | `src/app/{thread,episode,show,search,routes}.tsx`, `src/components/{thread-row,message-body}.tsx`, `src/lib/{format,usenet}.ts` |
| Data extraction evidence | `plans/2026-09-21-organize-{usenet,forums,capsules,discourse}.py` (four scripts) |

If useful, delegate by source type (Usenet, forums, capsules) with a shared contract; keep schema/import coordination with one owner to avoid conflicting migrations. The user suggested agents per show or source. Do not silently invoke a different orchestration skill merely because this document names Fable.

## Acceptance checks — required to call the work complete

- [ ] Catalog covers every collected source/document/record at inventory level; every screened candidate has accepted/excluded/needs-review disposition and evidence. Counts reconcile by source/show and distinguish unresolved work.
- [ ] Family Guy's verified February 1, 1999 pilot reactions appear under the correct pilot episode with the original community and usable provenance location.
- [ ] South Park imports account for exactly 1,324 unique native post IDs and 1,326 observations in this snapshot; accepted/excluded counts reconcile. Post `357190`, topic `15576`, retains `2005-11-28T19:45:00Z`, minute precision, separately from its 2024 capture and edit evidence. Posts `359263` and `364957` are each counted once despite pagination overlap. Later replies are not labeled premiere reactions.
- [ ] All 281 capsules have catalog/mapping/extraction dispositions. Verify `2F09`: January 8, 1995 air date and February 22, 1997 revision are not contributor posting dates. Verify `9F10`: its September 10, 1994 HTML conversion date is not an original post date. Exercise both HTML and plain-text capsule layouts.
- [ ] Seinfeld's weak candidates have been evaluated; incidental mentions are excluded or left explicitly unresolved, not indiscriminately imported as episode reactions.
- [ ] Crossposted Message-ID in two communities and relevant to two shows has one canonical identity, all observations and correct per-show counts. Repeated import is idempotent. Same-ID body conflicts, no-ID records and long bodies remain accounted for.
- [ ] Legacy content/classification stays attached correctly; source backfill does not invent evidence. Existing public thread URLs and representative search results continue working. All nine existing shows survive unchanged except intentional, documented additions/counter corrections.
- [ ] Source locations work for original links, archive-only material, unavailable permalinks and multiple captures. Labels distinguish original posts, group homepages and archive collections. Both thread views, episode/search listings and source catalog work at desktop/mobile sizes.
- [ ] Day-only, unknown-zone and unknown-date material display honestly and do not acquire fake precise timing. No exposed raw author emails, filesystem paths, unsafe HTML or unsupported publication statuses.
- [ ] Meaningful tests cover identity/dedup, resumability/input changes, shared-source ownership, capsule dates, forum pagination, link serialization, route precedence and timing/counts. Run `bun run typecheck`, relevant `bun test`, build, and browser verification of changed flows. Use migrations, never `db push`.
- [ ] Actual local database import executed and verified; provide exact commands, row-count reconciliation, example app URLs and source-location evidence. Merely generating JSONL or committing code does not satisfy integration.
- [ ] Update `cliffnotes.md`, `decisions.md`, `updates.md` and relevant feature/verification docs. Preserve research snapshots; write new run reports under dated `plans/` files.

Finish with a concise report: data accepted by show/source, duplicates merged/evidence added, excluded/unresolved counts, capsule catalog/extraction results, actual URLs demonstrating source locations, tests run, and exact local versus deployed status. Prioritize completing the collected corpus; expanding research into inaccessible Google Groups/No Homers/Toonzone archives is a follow-on, not a reason to leave this import unfinished.
