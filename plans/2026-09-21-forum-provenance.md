# Official South Park forum provenance audit

- **Date:** 2026-09-21
- **Status:** done
- **Type:** analysis
- **What:** Verified forum provenance and implemented local file organization; no application/schema changes.

## Verified local evidence

Inspected all 91 gzip WARC records in `data/archives/research-2026-09-21/southpark-threads/`, plus the collector and collection manifest. They contain 91 distinct `WARC-Record-ID` values, 1,326 rendered post blocks and **1,324 unique original post IDs**. Every page explicitly states `All times are UTC` in its footer.

| Original topic ID | Episode | Rendered blocks | Unique post IDs |
| --- | --- | ---: | ---: |
| 15576 | Free Willzyx | 211 | 210 |
| 15753 | Bloody Mary | 304 | 303 |
| 18874 | Smug Alert! | 236 | 236 |
| 19318 | Cartoon Wars Part II | 575 | 575 |

The two overlaps are post `359263` on `15576-105.warc.gz` / `15576-120.warc.gz`, and post `364957` on `15753-150.warc.gz` / `15753-165.warc.gz`. Their displayed dates and inspected content fragments match. Page boundaries are not post identities.

Concrete first-page example (`15576-0.warc.gz`):

- Community: official South Park forum; original thread `15576`, forum category `3`.
- Original page: `https://southpark.cc.com/forum/viewtopic.php?f=3&t=15576`.
- First post: DOM `id="p357190"`, permalink `https://southpark.cc.com/forum/viewtopic.php?p=357190#p357190`.
- Author: display name `nall`, source account `237162` from `memberlist.php?mode=viewprofile&u=237162`.
- Displayed original timestamp: `Mon Nov 28, 2005 7:45 pm`; page UTC evidence permits `2005-11-28T19:45:00Z`, **minute precision**. Do not claim observed seconds.
- An edit notice says November 28, 2005 at 19:48, one edit. This is a separate edited timestamp; the body is the version visible at capture, not proven original wording.
- `WARC-Date: 2024-01-10T02:45:13.501005Z`.
- `WARC-Record-ID: <urn:uuid:ef0dc983-30cf-4b8a-9382-be240fc7e395>`.
- `WARC-Payload-Digest: sha1:JATR3YYIOKZ2B7OWHIX2UBVNEQSIHCFM`.
- Archive container: `https://archive.org/download/southpark.cc.com_forum_20240110/southpark.cc.com-forum-00000.warc.gz`; compressed offset `3138118898`, length `34707`.
- Local compressed-record SHA-256: `7f0149c739f7cd0d8f09a33ee0c00ce256765dac7e7235a2c59df8b97b292ee1`.

WARC capture time, HTTP response `Date`, original post time, edit time and our retrieval time are distinct. The current forum manifest records CDX capture time to seconds but not our retrieval time. File mtime and a later verification timestamp should not be invented as exact retrieval times for existing files.

## Minimum source-aware representation

Use stable source/community identity independent of show, domain and archive provider. Suggested source key `southpark-official-forum`, kind `forum`, display name `South Park Forums`; store original-domain aliases as metadata. Internet Archive / ArchiveTeam is the collection provider, not the original community. Toonzone / Anime Superhero needs the same distinction across renamed domains.

For each post retain:

1. `sourceId`, `externalPostId`, `externalThreadId`, `originalUrl`, source-scoped `authorExternalId`, author display name, original text/structured quote content.
2. Raw post-date text, parsed instant when justified, precision (`minute` here), timezone (`UTC` here), timezone evidence, edit metadata if present. Unknown dates must remain unknown; never substitute archive capture dates.
3. One or more provenance/capture references with original captured page URL, collection ID, WARC record ID/date, container URL/path, compressed offset/length, payload digest, local checksum, and extractor version.
4. Show and episode associations separately from source identity. A shared community can discuss several shows, and a show can have many communities.

Unique original-post key is `(sourceId, externalPostId)`. Topic identity is `(sourceId, externalThreadId)`. Do not hash body text as the primary identity: edits change text, and separate people can post identical short reactions. Preserve additional captures as observations/versions instead of overwriting source history or creating another counted post. A quote of a post is not another source post.

Author identity is source-scoped; do not merge identical usernames across forums or merge them into Usenet email-hash identities without evidence. Deleted/guest accounts may have no stable account ID and need nullable identity fields.

## Adapter requirements

- Parse WARC and HTTP framing before HTML. Store WARC metadata rather than deriving it solely from the CDX row. All sampled payloads are UTF-8 HTML, but respect recorded HTTP charset for later collections.
- Parse HTML structurally, not using a single regular expression for nested post bodies. The corpus has **885 `<blockquote>` occurrences**. Preserve quote boundaries, links and smiley alt text, and exclude navigation, user profiles, signatures when rendering/indexing rules call for it.
- Extract posts from `div#p<digits>.post`; extract their own `p.author`, source permalink, profile link, content and edit notice. Profile join dates must never be used as post dates.
- Keep sequential topic order. Forum posts do not supply Usenet `References`; a quotation does not reliably establish a reply parent. Do not synthesize a JWZ chain or infer replies solely from adjacency.
- Preserve original URLs including capture aliases in provenance; create canonical post URLs from the observed `p` permalink. Drop session IDs only from canonical identity, not from the raw captured URI.
- Use original per-post dates for episode timing. These threads mix pre-air speculation, contemporary reactions and later replies. Existing thread-start `live|retro` is insufficient to label every message.
- Existing local captures expose updated titles and edited content. Store the observed version and capture evidence; do not present it as an immutable snapshot from 2005.

## Bounded implementation acceptance checks

For this fixture corpus an adapter should yield exactly **4 topics, 1,324 distinct source posts, 91 page captures**, with two posts linked to two captures. The first post of topic `15576` must be post `357190`, author account `237162`, timestamp November 28, 2005 at 19:45 UTC, precision minute, edit at 19:48. Repeat import must not increase logical post counts. A changed body in a later capture must preserve its provenance rather than changing its identity.

Counts establish the collected subset, not overall forum completeness. Update/requisite WARC indexes were excluded from collection; deleted posts and older pre-migration content remain unproven. Raw HTML/WARC stays gitignored and display continues the project's address-redaction rules.

## Implemented local adapter

`plans/2026-09-21-organize-forums.py` exposes `run(root: Path, out: Path) -> dict`. Running the script directly writes `data/archives/research-2026-09-21/organized/sources/southpark-official-forum/{source.json,records.jsonl,observations.jsonl,summary.json}`. It performs no network or database operations.

Command: `python plans/2026-09-21-organize-forums.py`.

The source metadata distinguishes the original community from its archive provider. Each unique post has a stable source-scoped ID; observations retain original page URLs, WARC UUID/date/digests, exact byte-range evidence, artifact hashes, edit metadata and extracted body text. Retrieval dates remain null because the original collector did not record them. Quote blocks retain explicit `[quote]` / `[/quote]` boundaries, and profile metadata is excluded from post bodies. The logical record uses the first encountered observation; differing body hashes set `hasContentConflict` and every variant remains in observations.

Executed successfully: **1,324 records, 1,326 observations, 91 artifacts, four topics, two duplicate observations, zero body conflicts, zero unknown post dates/timezones**. Verified first-post identity, UTC date, edit time and account ID against raw HTML; all 885 quote boundaries survived; repeated execution produced byte-identical output hashes. Adapter checks each input artifact against its collection-manifest SHA-256 and asserts per-page post counts. This is local organization, not public-ready rendering or database ingestion.
