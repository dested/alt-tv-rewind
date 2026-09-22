# Source-aware research collection

- **Date:** 2026-09-21
- **Status:** done
- **Type:** analysis
- **What:** Organize the collected original-era discourse into traceable local files before changing the application database.

## Decision and scope

The user chose **organize collected files first**. Application tables, pipeline checkpoints, deployed data and UI remain unchanged. Three source-specific adapters handle Usenet, the official South Park forums, and Simpsons capsules. A common coordinator validates their output and builds source/artifact indexes and show associations.

The original research findings and URLs are in [the source catalog](2026-09-21-original-discourse-research.md). Source-specific reviews: [Usenet](2026-09-21-usenet-provenance.md), [forums](2026-09-21-forum-provenance.md), [capsules](2026-09-21-capsule-provenance.md).

## Files

Everything containing source bodies remains under the existing gitignored research directory:

```text
data/archives/research-2026-09-21/
  <original mboxes, capsules/, southpark-threads/, indexes and manifest>
  organized/
    sources.json                  source registry with observed coverage/counts
    artifacts.jsonl               original file paths, hashes, collection evidence
    show-associations.jsonl       record-to-show links with status and evidence
    summary.json                  validation result and collection totals
    sources/
      usenet-rec-arts-tv/
      usenet-rec-arts-animation/
      usenet-alt-tv-game-shows/
      usenet-alt-tv-familyguy/
      usenet-alt-tv-simpsons-itchy-scratchy/
      southpark-official-forum/
      simpsons-archive-capsules/
        source.json               source identity, type and notes (in every source directory)
        records.jsonl             distinct records within that source
        observations.jsonl        every recovered occurrence and raw-file locator
```

`plans/2026-09-21-organized-discourse-inventory.json` is the small, checked-in inventory. It contains metadata and counts, not recovered bodies. Existing original files stay in place; their SHA-256 hashes are verified during indexing.

## Shared version 1 format

Every content record has a `sourceId`. The source identifies the original community or compilation; Internet Archive is a recovery provider recorded on the artifact, not the authoring community.

| Field | Meaning |
| --- | --- |
| `schemaVersion` | `1`, independent of the application schema |
| `sourceId` | Stable source/community key |
| `recordId` | SHA-256 of `sourceId + ':' + externalId`; identity within a source |
| `canonicalId` | Cross-source identity where supported; Usenet uses an original Message-ID hash |
| `kind` | `post` or `compiled_document`; capsules are not invented forum posts |
| `externalId`, `threadExternalId` | Native post/document and thread identities; thread nullable for Usenet/documents |
| `originalUrl` | Original source permalink when available; nullable |
| `title`, `author`, `bodyText` | Extracted content; author uses display name/source account, not an email identity |
| `postedAt`, `postedDate` | Original timestamp evidence; timestamps require a supported timezone, day-only values have no fabricated instant |
| `datePrecision`, `dateTimezone`, `dateRaw` | Explicit precision, timezone evidence and original date text |
| `contentSha256` | Hash of extracted UTF-8 text; integrity/version aid, not identity |

Each **observation** links a record to an exact original artifact through `artifactPath`, `artifactSha256`, and `locator`. It also carries a stable `observationId`, the observed content hash, original URL, and separate `capturedAt` / `retrievedAt` fields. Adapters add native evidence: mbox byte offsets and raw hashes, or WARC record ID, capture time, remote range and post DOM ID.

Unknown capture/retrieval times stay null. The collector's `verifiedAt` means a local file was checked then; it does not prove when that file was first downloaded. WARC capture dates are never original posting dates.

## Identity, dates and counting

- Usenet is rebuilt from all five complete new mboxes, preserving every occurrence before any show filtering. Within a group, the first occurrence supplies the record text. Additional copies and different bodies retain their own observation hashes and pointers to the immutable raw bytes.
- The same RFC Message-ID across groups shares a `canonicalId`; each community occurrence keeps its source-specific record. This permits deduplication without losing crosspost provenance. It does not assert that differently identified, similar-looking messages are the same post.
- Missing Usenet IDs fall back to raw-byte hashes. This preserves otherwise dropped records, but cannot prove that differently serialized unidentified copies are the same post.
- The forum adapter uses native post IDs. Its 1,326 captured blocks contain 1,324 unique posts; two posts overlap page boundaries. The original page footer establishes UTC, while the displayed post timestamps have minute precision. Account join dates and capture dates are separate.
- Capsules remain 281 compiled documents. Episode air dates, revision dates, conversion dates and copyright years are document metadata, never substituted for a contributor's posting time. Extracting individual contributions remains future work.
- Show links are independent records. The 10,466 Usenet candidate memberships retain their broad keyword evidence and **candidate** status; they are not verified episode reactions. Forum/capsule links describe the selected source context. `episodeId` stays null pending attribution.
- Complete Usenet files include material beyond 2009. Keeping those records preserves the source, but research views must filter original dates to the requested era. Raw counts do not establish topical relevance, human authorship, or freedom from spam.

## Reproduction

After downloading the original corpus and running its coverage audit:

```powershell
python plans/2026-09-21-organize-discourse.py
```

This runs all three adapters locally, verifies record identities and text hashes, checks every observation's raw-file provenance, hashes original collection artifacts, and rebuilds indexes. It makes no network requests or database writes.

To verify/reindex outputs already generated by the adapters:

```powershell
python plans/2026-09-21-organize-discourse.py --adapter none
```

`--adapter usenet`, `--adapter forums`, or `--adapter capsules` rebuilds only that adapter, then validates the whole bundle; the other adapters' outputs must already exist. Original downloads are never moved or rewritten. Derived JSONL is reproducible and may be replaced on rerun.

## Why this precedes application ingestion

The current application has a unique `Archive.newsgroup` owned by one `Show`, destructive archive reloads, and show-level stage keys such as `t0`. Registering a shared group under another show could reassign and purge the first show's archive. Adding source material can also change thread numbering and invalidate classifications. These are concrete integration issues, not solved by adding a label to `Message`.

The organized files establish the evidence needed for a future migration: independent source and artifact identity, multiple observations per post, source-independent show associations, native forum threads, and honest timestamp precision. No new research data should be passed through the current single-newsgroup loader until that separate integration is designed and verified.

## Verification

The completed bundle has **7 sources, 388,353 source records, 391,362 observations and 387,529 canonical content identities**. These totals cover the complete collected archives, including off-topic and later-era content. The coordinator resolved all **10,466 candidate show associations** and **1,605 forum/document context associations** and verified **389 distinct raw artifacts**.

| Source | Records | Observations |
| --- | ---: | ---: |
| rec.arts.tv | 173,216 | 173,391 |
| rec.arts.animation | 129,714 | 132,443 |
| alt.tv.game-shows | 77,566 | 77,660 |
| alt.tv.familyguy | 852 | 852 |
| alt.tv.simpsons.itchy-scratchy | 5,400 | 5,409 |
| South Park Forums | 1,324 | 1,326 |
| Simpsons capsules | 281 | 281 |

The Usenet adapter preserves 2,675 records lacking Message-IDs, 70,707 day-only dates and 245 bodies exceeding the application's legacy 65,536-character limit. Its 3,007 repeated observations include six differing body versions. Cross-source canonical identity joins 824 additional community memberships. Forum pagination accounts for the other two repeated observations.

`python plans/2026-09-21-organize-discourse.py --adapter none` passed. It checks the known counts for this fixed collection, stable source/native and canonical IDs, every normalized record's body hash, observation membership, and all raw artifact hashes. For Usenet it replays every byte range, verifies each raw-message hash, and proves contiguous coverage of each full mbox. Forum observation bodies and IDs are checked against their extracted records; the forum adapter independently checks HTML post boundaries, original dates, WARC evidence and per-page counts. Capsule observations point to whole documents, with dates kept separate and text decoding checked by the adapter. This is not a claim that the coordinator independently re-extracts every HTML body.

The coordinator fails on missing or truncated sources, duplicate record/observation IDs, orphan observations, changed raw bytes, body-hash mismatches, unresolved candidate associations, or document/day-only timestamps represented as precise instants. Adapter fixture checks covered MIME decoding, absent IDs, exact-case Message-IDs, unknown timezones, changed-body duplicates and stable reruns. Forum and capsule checks covered the real collected samples. Python syntax, `bun run typecheck` and `git diff --check` passed.
