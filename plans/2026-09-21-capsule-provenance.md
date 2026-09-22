# Simpsons capsule provenance review

- **Date:** 2026-09-21
- **Status:** done
- **Type:** analysis
- **What:** Capsule provenance review and executed source-aware file adapter; no application/schema changes.

## Evidence inspected

All 281 collected capsule files have an `.html` extension, but inspecting their contents identifies 170 HTML documents and 111 plain-text documents. The collection manifest already retains their original URL, file path, SHA-256 and verification time. The corpus is structurally heterogeneous: some capsules use heading elements and PRE blocks; others organize sections inside preformatted text. A single `Reviews` heading selector will miss valid material.

| Local sample / original URL | Actual evidence | Storage consequence |
| --- | --- | --- |
| `capsules/2F09.html`, [Homer the Great](https://simpsonsarchive.com/episodes/2F09.html) | Episode air date January 8, 1995; capsule revision E dated February 22, 1997; ten attributed review paragraphs without individual posting timestamps. One attribution is `Yours truly`, resolved only through compiler context. | Air date, document revision and contributor posting date are separate fields. Posting date remains unknown unless independently recovered. |
| `capsules/9F10.html`, [Marge vs. the Monorail](https://simpsonsarchive.com/episodes/9F10.html) | Attribution-bearing comments; no standard Reviews heading, original-airdate header or capsule revision marker. HTML conversion footer dated September 10, 1994. | Conversion date describes this representation, not the original commentary. Comments need their own type, not fabricated review/thread records. |
| `capsules/7G08.html` | Compilation copyright dated 1991 and an update credited in 1999. | Year values in notices do not establish when a review was posted. |
| `capsules/DABF01.html` / `DABF02.html` | Episode air dates in 2002/2001, revision A in 2004, review sections with aggregate grades. | Aggregate grade lines are editorial derived data, not additional contributor opinions. |

Some documents contain explicit public-redistribution restrictions in their compilation notices, including `2F09` and the DABF examples. Preserve the notice verbatim in the local artifact metadata and keep republication eligibility separate from download/extraction status. A downloadable capsule is not evidence of permission to republish the full compilation.

## Recommended representation

Use a source registry plus document/contribution provenance, even if the initial implementation stores these as JSONL sidecars:

1. **Source:** `simpsons-archive`, kind `compiled_episode_capsule`, canonical domain and aliases (`snpp.com`, current domain), source display name. Do not label every constituent contribution as Usenet: capsules also incorporate email, forums and editorial writing.
2. **Artifact:** original/final URL, retrieval time, raw content hash and path, content type/encoding, revision label/date with raw date text, conversion date where stated, compiler attribution, rights notice. Cache verification time is distinct from original capture/retrieval time.
3. **Document:** stable source ID plus production code; title and show/episode association. Use production code as an attribution clue, then validate against the show's episode index, rather than treating every capsule as a numbered regular episode.
4. **Contribution:** kind (`review`, `observation`, `editorial`, etc.), display attribution exactly as printed, text, source-local stable extraction locator, raw artifact hash, extraction version, original timestamp nullable with precision/evidence, optional original community/URL/Message-ID only if supported. No inferred reply edges or synthetic thread start.
5. **Evidence relationship:** compilation contribution `reproduces` or `possibly_reproduces` a recoverable original message; retain both source occurrences. Proven matches can share one analytical opinion identity without discarding either citation. Keep uncertain matches separate and out of automatic merges.

The author display name is not a global identity key. Same-name contributors across Usenet and web sources need evidence before linking, and `Yours truly` needs compiler context. If resolved, preserve the printed label alongside the resolution/evidence. Do not turn capsule mailto addresses into public author metadata.

For stable contribution IDs, use a maintained source-local key and retain content hashes per version. Byte offsets/DOM locations belong to artifact-specific locators: revisions change offsets and ordering. A hash-only contribution ID also changes on minor editorial corrections.

## Timing and counting

- Unknown original dates must remain nullable. Do not use episode air date, capsule revision, conversion footer, file mtime or retrieval date to fill them.
- Phrases implying immediate viewing can support a qualitative timing claim with evidence, but do not prove a calendar timestamp or that the viewing was the first US broadcast.
- Count extracted attributed reviews separately from original dated posts. Exclude undated contributions from per-day reaction charts and exact premiere-window totals.
- Reproduced review text and the recovered original Usenet message count as one opinion only after a justified match. Normalize whitespace for candidate matching; require substantial distinctive text plus attribution/context, and preserve the exact originals.
- The complete capsule includes long episode quotations, editorial summary, observations and grades. Treating the entire body as one fan message would contaminate full-text search, sentiment, episode discussion volume and poster counts.

## Actionable next work from the existing files

1. Extract section boundaries and contributor labels across at least an early Raymond Chen capsule, a James Cherry capsule and a later Benjamin Robinson capsule before choosing a universal parser. Create an extraction audit queue for unrecognized layouts.
2. Use distinctive review excerpts, named contributors and production codes as search keys for original `alt.tv.simpsons` messages. Those originals can restore timestamps and thread context missing from the compilation; they should be preferred for chronological analysis.
3. Prioritize the collected `alt.tv.simpsons.itchy-scratchy` mbox for episode-code/title searches rather than only show-name keywords. The initial audit can miss such messages, and the local archive reaches 1992.
4. The retained episode index links 48 lowercase `episodes/mgNN.html` Tracey Ullman short capsules and 15 nested `episodes/mini/MCNN.html` promotional capsules excluded by the collector's uppercase/flat regex. These are deliberate lower-priority opportunities, largely outside the requested regular-episode focus; the omission does not establish additional original discourse. `episodes/scg.html` is a syndication-cuts guide, also excluded, and is context rather than a forum.
5. The failed `7F76.html` is the *Deep, Deep Trouble* music-video capsule, not a missing regular television episode. An archive lookup can recover it later; it should not distract from missing 1990s original message timestamps.
6. The episode index's later-season links often lead to `episodeguide/seasonNN.html` reference guides rather than capsules. Do not equate their existence with recovered review sections or contemporaneous forums.

## Implemented file adapter

`plans/2026-09-21-organize-capsules.py` exposes `run(root: Path, out: Path) -> dict` and defaults to the retained collection's `organized/` directory. It uses only the Python standard library and no network. Executed successfully: **281 compiled-document records and 281 raw-file observations**, under `organized/sources/simpsons-archive-capsules/` with `source.json`, `records.jsonl` and `observations.jsonl`.

The adapter detects actual HTML versus plain text, decodes strictly without inserting replacement characters, retains readable full document text and source/content hashes, and preserves raw copyright notice spans within the normalized body. A number of originals already contain replacement characters; the output preserves and counts these rather than claiming to restore lost text. Document air/revision/conversion metadata remains separate from posting dates. Two-digit years stay as raw evidence rather than accepting Python's implicit century cutoff. Posting date/time and author fields are null for every compiled document. Retrieval dates remain null because manifest verification timestamps do not prove first retrieval.

Verification checked all 281 record IDs, every source and normalized-content hash, every retained rights span, all unknown-post-date invariants and observation links. Raw artifacts were not modified. No new bulk downloads were performed. Findings come from retained local originals and the collection manifest. Parent task owns shared schema decisions, research-report revisions and the combined task-log update.
