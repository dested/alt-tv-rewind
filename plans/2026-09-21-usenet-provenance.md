# Usenet provenance contract

- **Date:** 2026-09-21
- **Status:** done
- **Type:** analysis
- **What:** Read-only audit of the legacy ingest and an additive contract for source-aware research storage

## Recommendation

Store source communities, downloaded artifacts, content identities, artifact observations, and show associations separately. A single source label on a message cannot retain multiple archive observations of the same crosspost. Keep this collection layer independent from the existing display database until an explicit import connects it; no production data rewrite is needed to collect correctly now.

For Usenet, `rec.arts.animation` is the community; Internet Archive is the custodian; a particular ZIP/mbox is the artifact; the RFC Message-ID identifies the post. Family Guy and Simpsons are associations of that content, not owners of the community.

## Minimal record contract

| Record | Required fields and identity |
| --- | --- |
| Source | `sourceId` stable slug; `kind` (`usenet`, `forum`, `capsule`, `article`); display name; canonical community key; original homepage if known. A Usenet community key is its lowercased group name. |
| Artifact | `artifactId`; `sourceId`; local relative path; download URL; custodian; byte length; SHA-256; retrieval timestamp if known; verification timestamp separately; format. ZIP and extracted mbox have distinct hashes and a parent relationship. |
| Content | `contentId`; type; nullable original Message-ID; decoded subject/body; original date string; nullable normalized date; precision; date derivation; raw newsgroups; References; In-Reply-To. |
| Observation | `observationId`; `contentId`; `artifactId`; record ordinal or byte offset/length; SHA-256 of observed record; original URL if known; capture timestamp if known; parser version. Retain every observation even when content already exists. |
| ContentShow | `(contentId, showSlug)`; match method; match evidence; review status. Keyword candidates remain candidates. |

Use `contentId = sha256("usenet:" + originalMessageId)` with the original bracketed ID preserved exactly. Do not lowercase or strip meaningful characters from Message-IDs. Missing IDs need `identityMethod = raw-sha256` with a clearly synthetic identity, not a fabricated RFC ID. This fallback represents identical raw records only; it does not promise equivalence between altered exports. Same-ID, different-content observations must be retained and flagged, never silently overwritten. Content equality hashes alone are not grounds to merge posts from unrelated communities.

An observation's source is the group in the artifact manifest. `Newsgroups:` is the message's declared distribution and must also be retained; it is not proof that an archive was retrieved from each listed group. A downloaded crosspost in two mboxes is one content identity and two observations. One post relevant to two shows remains one identity and two show associations.

Do not persist raw `From:` addresses in the public serving database. Keep original bytes in the existing gitignored archive storage; the display representation keeps the established hashed poster identity and address-redaction behavior. Original headers and Message-IDs also belong behind a deliberate public serialization boundary.

## Dates

- Keep the exact original `Date:` and any `NNTP-Posting-Date`/`Injection-Date` evidence. The normalized timestamp alone cannot explain which header won.
- `precision` should support `instant`, `day`, and `unknown`; date source should distinguish original header, posting header, inherited parent/thread, and unknown. Unknown original dates stay unknown in the collection layer.
- The legacy pipeline uses noon UTC for day-only headers. Preserve that compatibility representation only alongside `precision: day`; noon is not an observed posting time.
- `parseDate` can prefer a timed posting header when a day-only Date is nearby. This is a useful derivation but should name its source header rather than appear as exact original authorship time.
- Legacy JWZ supplies a parent's or thread's date for missing dates. That inferred sort date must not become an asserted original post date.
- Artifact capture, local retrieval, and verification time are different from original posting time. Existing collector `verifiedAt` values on cached artifacts prove verification time, not first retrieval; do not relabel them as historical capture times or fabricate retrieval time.

## Exact hazards in the current code

1. `pipeline/lib/context.ts` takes one `show.newsgroup` and one mbox path. `Archive.newsgroup` is globally unique while `Archive.showId` is singular. `load.ts` upserts by newsgroup, changes its show ID, then deletes its threads. Reusing `rec.arts.animation` under another show would move/purge the first show's archive.
2. `jwz.ts` deduplicates by Message-ID before threading and keeps only the first copy. An additive provenance implementation must union observations before this step, including differing bodies/date headers. The current stage discards all evidence of later copies except a numeric duplicate count.
3. Checkpoint keys (`t0`, `t1`, …) are ordered by earliest date and are not stable when new records arrive. Existing classification/enrichment files can attach to the wrong thread after a partial reparse. Add an input fingerprint/schema version and require compatible downstream checkpoints, or use an isolated collection run. Do not run only `parse,thread,load` over an already-classified work directory with changed sources.
4. `load.ts` gives every message and thread the one context archive ID; it drops parsed newsgroups and References. Parent/root/pull-quote resolution is archive-scoped. Adding source fields to Zod alone does not persist provenance in the database.
5. Existing `Message` uniqueness is `(archiveId, messageId)`, so duplicate copies across archives inflate counts. For a source-aware serving implementation, message identity and show membership must be explicit; per-show counts should count distinct identity, while source counts can count observations.
6. JWZ subject merging has no source boundary. Running forums and unrelated communities through it would merge similarly titled discussions within 30 days. Usenet References can cross groups, but subject-only merging should remain within a community. Native forum thread IDs bypass JWZ.
7. Public thread slugs hash the earliest message ID. Discovering an older message changes that slug even if the conversation is the same. Preserve existing slugs with an identity/alias table when expanding old threads; do not describe the current hashes as stable under source expansion.
8. `parse.ts` drops records without Message-ID; `mime.ts` caps decoded bodies at 65,536 characters. A collection store needs raw artifact pointers plus missing-ID/truncation flags to retain content unavailable to the serving pipeline.
9. `load.ts` calculates `live|retro` with UTC millisecond endpoints; the documented ADR promises ET calendar days. This existing mismatch is independent of provenance but must not be used to assert precise original-broadcast timing for new records.

## Candidate audit limitations

`plans/2026-09-21-audit-discourse.py` is a discovery screen, not an import format. Its candidate mboxes contain only novel keyword matches per show and retain just the first newly encountered copy. The metadata has a hashed identity, chosen source group, subject and day; it does not contain all duplicate observations, original-date evidence, or a raw byte pointer. Rebuild provenance from the five complete retained mboxes and their manifest, not from candidate files alone.

It also omits already-known messages before producing candidate metadata; those duplicates are precisely where new source observations should be linked to existing content. Its body keyword screen does not MIME-decode and it does not include reply closure. Preserve those limits in any exported counts.

## Safe integration sequence

1. Build the independent source/artifact/content/observation/show-association collection, preserving originals and all observations. Parse each complete input once, then screen content for shows.
2. Give existing show configs an optional list of source IDs, defaulting to their existing newsgroup source. Keep old commands valid. Generic communities can associate with many shows.
3. Add serving provenance tables through migrations and nullable links/backfill for legacy rows. Do not guess precise artifacts or capture dates for historical loads without hashes/manifests.
4. Add a deliberate import adapter with compatible checkpoint identity and dedup rules; legacy display rows may continue as projections while sharing canonical source content.
5. Verify two-source crosspost dedup, multi-show membership, same-ID conflict retention, missing-ID records, day-only/unknown dates, rerun idempotence, and changed-source checkpoint rejection before bulk import.

No shared application code or database was edited for this audit.
