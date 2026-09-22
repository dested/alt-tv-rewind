# Original broadcast discourse: Family Guy, The Simpsons, South Park, Seinfeld

- **Date:** 2026-09-21
- **Status:** done
- **Type:** analysis
- **What:** Verified source catalog, coverage audit, and first local collection of original-era discussions; prioritize the 1990s–2000s.

## Result

Original discussions survive, and several usable collections are now local. The strongest additions are **Family Guy's February 1, 1999 pilot reactions**, **1990s Simpsons material missing from our main archive**, and **the rescued official South Park forums**. Seinfeld remains best served by its existing Usenet archive; this pass did not find a comparably strong independent 1990s forum corpus for it.

Collected **five additional Usenet mboxes containing 389,755 raw records**, **281 Simpsons capsule files**, and **91 pages / 1,326 rendered post blocks across four official South Park episode threads**. The five mboxes total 1,000,416,128 uncompressed bytes. ZIPs, indexes, experimental samples and candidate derivatives consume additional disk space.

A first keyword screen produced **9,426 distinct messages**, representing **10,466 show/message matches**, absent from the corresponding existing show archive by Message-ID. These are **candidates**, including incidental mentions, quoted material and spam—not 10,466 verified premiere reactions. One message can concern multiple shows. No new material has been loaded into the app or production database.

This is a completed research and collection pass, **not an exhaustive census of all surviving internet discussion**. Search indexing, deletions, incomplete exports, dead sites and access restrictions leave substantial gaps.

## Deliverables and reproduction

| Artifact | Purpose |
| --- | --- |
| `plans/2026-09-21-discourse-inventory.json` | Checked-in coverage results, collection manifest, source URLs, byte sizes and SHA-256 hashes |
| `plans/2026-09-21-collect-discourse.py` | Standard-library collector; verifies Internet Archive files against listed sizes/SHA-1, retrieves capsules, recovers selected WARC pages by byte range |
| `plans/2026-09-21-audit-discourse.py` | Reproduces baseline audit and deduplicated 1989–2009 keyword candidate mboxes |
| `data/archives/research-2026-09-21/` | Gitignored raw collection, indexes, manifests, audit outputs and small exploratory downloads |
| `data/archives/research-2026-09-21/candidates/<show>.mbox` | Four candidate mboxes, retaining original message headers and bodies |
| `data/archives/research-2026-09-21/capsules/` | Downloaded Simpsons capsules; compiled documents, not individual post records |
| `data/archives/research-2026-09-21/southpark-threads/` | 91 independently decompressible archived HTTP/WARC records |

Run from the repository:

```powershell
python plans/2026-09-21-collect-discourse.py
python plans/2026-09-21-audit-discourse.py
```

Run these sequentially: the audit rewrites its candidate files. Collection reuses complete files; partial downloads never become completed files. The collector currently exits nonzero for the one known missing capsule (`7F76.html`, HTTP 404), while preserving successful downloads and recording the failure. The audit needs the existing `data/work/<show>/messages.jsonl` files for deduplication. These are research utilities, not a new production ingestion stage.

## What the project already had

Measured by streaming the local `messages.jsonl` checkpoints, not by trusting show totals or archive labels. Dates below are the stored date prefixes; they do not assert broadcast-time precision. Counts include material not necessarily relevant to an episode.

| Show | Parsed records | Earliest–latest stored date | Critical gap |
| --- | ---: | --- | --- |
| Family Guy | 21,499 | 1999-05-09–2013-05-21 | Misses the January pilot and most of the first season's opening weeks |
| The Simpsons | 135,041 | 2000-03-29–2013-06-02 | **Zero 1990s posts; only four from 2000; substantial coverage starts in 2001** |
| South Park | 117,017 | 1997-07-25–2013-06-05 | Early run present, but does not include the separate official forum community |
| Seinfeld | 157,388 | 1992-06-25–2013-06-12 | No 1989–1991 records; one record lacks a parsed date |

South Park has 63,358 day-only dates, Family Guy 845, and Seinfeld 85,447 according to the parser summaries. Do not turn an archive viewer's midnight/default clock into a claim that a fan posted at a specific hour.

## Sources collected and their actual coverage

| Collection | Raw records | Observed coverage and value |
| --- | ---: | --- |
| [rec.arts.animation](https://archive.org/download/usenet-rec/rec.arts.animation.mbox.zip) | 132,443 | Dated material 1994–2013; strongest new cross-show source. Includes Family Guy pilot-week posts and 1990s Simpsons/South Park. 3,836 dates were not parsed by the research audit. |
| [alt.tv.familyguy](https://archive.org/download/usenet-alt/alt.tv.familyguy.mbox.zip) | 852 | Alternate spelling, distinct from registered `alt.tv.family-guy`; dated records start in 1999. 257 records in 1999. |
| [alt.tv.simpsons.itchy-scratchy](https://archive.org/download/usenet-alt/alt.tv.simpsons.itchy-scratchy.mbox.zip) | 5,409 | Dated records 1992–2012; supplies otherwise missing early Simpsons material. Not every message mentions the show by title. |
| [alt.tv.game-shows](https://archive.org/download/usenet-alt/alt.tv.game-shows.mbox.zip) | 77,660 | Almost all dated records start in 2001; 52,640 in 2002. The web has a 1999 Family Guy thread that this particular bulk export does not preserve. |
| [rec.arts.tv](https://archive.org/download/usenet-rec/rec.arts.tv.mbox.zip) | 173,391 | **138,061 records in 2012, 34,291 in 2013, one dated 1999, 1,038 unparsed dates. Not a solution to early Seinfeld coverage.** |
| [Simpsons Archive capsule index](https://simpsonsarchive.com/episodes.html) | 281 downloaded files | 282 distinct production-code HTML/text links discovered; one 404. Mix includes compiled episode material and specials/music-video entries; do not call this 281 timestamped discussion threads. |
| [Official South Park forum rescue](https://archive.org/details/southpark.cc.com_forum_20240110) | 91 selected pages | Four episode topics recovered across all their indexed offsets; three base WARC indexes retained for expansion. |

The audit's 1989–2009 filter is inclusive. It matches show names in decoded subjects and raw body text, so encoded bodies and episode-only subjects can be missed. It does not infer relevance from a newsgroup name, fetch all reply ancestors, classify spam, or assign episodes. `Simpson` surname matches can be false positives. The full source mboxes remain available for a better screen.

| Show | New candidate memberships | Subject matches | Body-only matches | New 1990s memberships |
| --- | ---: | ---: | ---: | ---: |
| Family Guy | 1,467 | 708 | 759 | 383 |
| The Simpsons | 6,658 | 1,923 | 4,735 | 3,868 |
| South Park | 2,002 | 517 | 1,485 | 1,049 |
| Seinfeld | 339 | 2 | 337 | 114 |

Deduplication is by original Message-ID within each show, with a raw-content hash fallback for messages lacking an ID. It is not cross-show deduplication and does not detect changed-ID reposts. Low Seinfeld subject relevance is a reason to deprioritize that candidate set, not claim a substantial new Seinfeld episode archive.

## Family Guy: best sources and concrete discoveries

1. **rec.arts.animation, collected locally.** The candidate metadata identifies `"All In The Family Guy"` on January 26, 1999 and `Family Guy Reactions` / replies on February 1, 1999. Reading the latter bodies confirms criticism of the actual first episode and comparisons with other animated shows. This is the exact kind of morning-after material the app needs. Preserve the raw `Date:` resolution. Source: [downloaded mbox](https://archive.org/download/usenet-rec/rec.arts.animation.mbox.zip); searchable local derivative: `candidates/family-guy.mbox`.
2. **The alternate alt.tv.familyguy group, collected locally.** Small enough to inspect comprehensively, with early material independent of the hyphenated group. Keep it as a source for the existing show, not a second show in the registry.
3. **Toonzone / Anime Superhero.** The [General Animation Talkback index](https://animesuperhero.com/forums/threads/general-animation-talkback-thread-collection.4528231/) links Family Guy discussion from season 4 onward. Its creation date is 2008; the linked discussions can be older. The [North by North Quahog broadcast thread](https://animesuperhero.com/forums/threads/animation-domination-family-guy-4acx01-north-by-north-quahog-spoilers.3875881/) contains May 1, 2005 reactions and spans nine pages in the observed version. Readable through web research; the direct bulk-fetch probe returned 403, so no bulk collection is claimed.
4. **AnandTech off-topic.** [July 11, 2001 Family Guy return thread](https://forums.anandtech.com/threads/family-guy-is-back-on-tonight-at-9-30-eastern-on-fox-watch-it-again-tonight.574382/) has both anticipation and people reacting while watching *The Thin White Line*. This reaches before the revival-era Toonzone index.
5. **Other Usenet groups.** [Game Show Reference on Family Guy](https://groups.google.com/g/alt.tv.game-shows/c/VzMSpNiw06Y), dated May 16, 1999, discusses the episode's game-show jokes. It demonstrates that show-only newsgroups miss original reactions. [OT: The Spalding Gray of Crap](https://groups.google.com/g/alt.tv.simpsons/c/ivFgYgyTovI) is indexed with April 18, 1999 Family Guy discussion in the Simpsons group; search evidence only in this pass, because direct opening failed.
6. **Contemporary review context.** [Ain't It Cool's July 2001 preview](https://legacy.aintitcool.com/node/9518) survives as an article; its historical talkback comments were not recovered. [Washington Post's January 30, 1999 review](https://www.washingtonpost.com/archive/lifestyle/1999/01/30/family-guy-time-to-take-out-the-garbage-dear/d246c208-0ed6-4aa4-9c39-76654c81cea3/) is a contemporary critic's response, not fan discussion. Keep that distinction in presentation.

**Timing trap:** [this April 23, 2005 Toonzone thread](https://animesuperhero.com/forums/threads/family-guy-north-by-north-quahog-discussion-spoilers.3869491/) explicitly discusses a leaked premiere. [Boards.ie](https://www.boards.ie/discussion/249081/family-guy-season-4-episode-1-north-by-north-quahog-spoilers) and [AnandTech](https://forums.anandtech.com/threads/new-family-guy-season-premiere.1583603/) also have pre-broadcast discussion. These are valuable, but belong to pre-air/leak coverage rather than first-broadcast reaction counts.

## The Simpsons: recovering the missing golden-era material

1. **The Simpsons Archive / formerly SNPP: collected.** The site's [capsule FAQ](https://www.simpsonsarchive.com/guides/capfaq.html) explains that contributions come from Usenet, No Homers threads and email. Its [submission guidelines](https://www.simpsonsarchive.com/capsub.html) favor reviews submitted shortly after broadcast. The collection preserves early reactions, but some contributions and revisions were added later. Store a capsule's original air date, revision date and evidence about individual review dates separately.
2. **Concrete capsule examples.** [Homer the Great](https://simpsonsarchive.com/episodes/2F09.html) includes a reviews section with differing reactions. [Marge vs. the Monorail](https://simpsonsarchive.com/episodes/9F10.html) preserves early commentary. Both were fetched and inspected; both are in `capsules/`. Capsule revision timestamps must never become reviewer post timestamps.
3. **Original 1990s Google Groups discussions survive.** [gosh! (I&STM)](https://groups.google.com/g/alt.tv.simpsons/c/Vtce4-s7lvA/m/PzGUg4DB10QJ) contains November 3, 1992 reactions to *Itchy & Scratchy: The Movie*. [Wilson shot Mr. Burns](https://groups.google.com/g/alt.tv.simpsons/c/1mtXy3VYXlA/m/aQo9BoR8VwoJ) preserves a May 26, 1995 prediction naming Maggie. It also has a 2015 reply: classify each message's date, not the entire thread as one period. Google Groups showed 429s during direct-fetch attempts; these are verified reading targets, not a downloaded full group.
4. **alt.tv.simpsons.itchy-scratchy: collected.** This satellite group contains dated 1992 records while our main Simpsons mbox has none. Use it to search episode titles and production codes, including I&S-related material which the initial keyword screen misses.
5. **No Homers Club: valuable, access-limited.** Search results expose actual dated posts, e.g. [What's the deal with Butterfinger?](https://www.nohomers.net/forums/index.php?threads/whats-the-deal-with-butterfinger.2279/) on February 11, 2002, discussing that night's chalkboard gag. The landing page fetched successfully; forum listing/thread requests hit 403 or verification pages. No claim of a harvested archive or established oldest surviving episode thread. The capsule FAQ independently confirms its role as an episode-contribution source.
6. **Toonzone: useful for 2000s, not missing 1990s.** Its [Treehouse of Horror XII information thread](https://animesuperhero.com/forums/threads/treehouse-of-horror-xii-episode-info.2843461/) has November 2001 posts. The master index mixes original broadcasts with later tribute/repeat threads for older episodes; index placement under “Season 1” is not evidence of a 1989 discussion.

**Priority:** extract review sections from capsules with document-level provenance, then recover 1990s main-group threads by episode title and production code. Do not invent a precise post date for undated capsule contributions or count copied capsule reviews again when their source Usenet post is found.

## South Park: a rescued official forum, plus independent audiences

[ArchiveTeam's project page](https://wiki.archiveteam.org/index.php/South_Park_Forums) identifies the shutdown on January 10, 2024 and links the saved corpus. Its listed regional domains served the same forum content, so they are aliases for deduplication, not independent communities. It also documents severe late-period spam; raw topic counts are not fan-discussion counts.

The [Internet Archive item metadata](https://archive.org/metadata/southpark.cc.com_forum_20240110) lists three base WARC files totaling about **15.51 GB compressed**. Their individual CDX indexes total about **22.41 MB**. All three base indexes were downloaded and scanned: **407,130 successful topic-page records, 188,159 distinct topic IDs**. These are index observations, including spam, and not a completeness guarantee. Update/requisite indexes were not used for this first selection.

The following topics are locally recovered. Dates are read from post-author metadata, not account join dates or the 2024 capture timestamp. Selected pages preserve original HTML within WARC records.

| Episode | Topic ID / original URL | Opening post date | Pages | Rendered post blocks |
| --- | --- | --- | ---: | ---: |
| Free Willzyx | [15576](https://southpark.cc.com/forum/viewtopic.php?f=3&t=15576) | 2005-11-28 | 15 | 211 |
| Bloody Mary | [15753](https://southpark.cc.com/forum/viewtopic.php?f=3&t=15753) | 2005-12-05 | 21 | 304 |
| Smug Alert! | [18874](https://southpark.cc.com/forum/viewtopic.php?f=3&t=18874) | 2006-03-27 | 16 | 236 |
| Cartoon Wars Part II | [19318](https://southpark.cc.com/forum/viewtopic.php?f=3&t=19318) | 2006-04-10 | 39 | 575 |

The original forum links are provenance and may no longer display content. Read local records or use the [archive item](https://archive.org/details/southpark.cc.com_forum_20240110). All 91 selected pages were recovered; three initial HTTP 500s succeeded on retry. Threads begin before broadcast and include later replies—one *Smug Alert!* reply is from 2017. “1,326 post blocks” is not “1,326 premiere-night reactions.”

**Recovery method tested:** read the CDX row's WARC filename, offset and compressed length; request that exact byte range; require HTTP 206 and the expected length; gzip-decompress and inspect the response. The collector records the original URL, capture timestamp, byte offset, length and content hash. This provides a practical path to expanding episode coverage without first downloading 15 GB.

Other verified routes:

- [Simpsons Already Did It, Toonzone, June 26, 2002](https://animesuperhero.com/forums/threads/south-park-simpson-already-did-it-talkback-spoilers.3047601/): same-date episode talkback, including while-watching reactions.
- [Good Times with Weapons, Home Theater Forum, March 17, 2004](https://www.hometheaterforum.com/community/threads/south-park-3-17-04-good-times-with-weapons.170149/): 41-post thread in the observed version, with broadcast-date reactions.
- [Make Love, Not Warcraft, Toonzone, October 4, 2006](https://animesuperhero.com/forums/threads/south-park-make-love-not-warcraft-talkback-season-10-5-premiere-spoilers.4211271/): original episode discussion.
- [Tip.It, October 5, 2006](https://forum.tip.it/topic/67505-south-park-make-love-not-warcraft-won-an-emmy/): gaming-community response. The title was later updated to mention the Emmy, showing why thread titles are not immutable historical evidence.
- [Whirlpool's Warcraft thread](https://forums.whirlpool.net.au/archive/601187): a separate audience with explicitly labeled AEST timestamps; preserve region and zone rather than assuming US broadcast timing.
- [Official October 2001 news post](https://southpark.cc.com/news/ypyf7f/464-breayle-october-31-2001): primary evidence that the BBS and fan IRC community already existed then. The four recovered topics do not establish that the 2001 BBS messages survived the later forum migrations.

## Seinfeld: strong existing Usenet, weaker new independent sources

The existing `alt.tv.seinfeld` mbox remains the first-choice corpus. Its pre-finale speculation, immediate response, and international airings need different timing labels.

- [What's the GD ending](https://groups.google.com/g/alt.tv.seinfeld/c/Tb-ABRoH3PM): displayed dates May 14–15, 1998; disagreement about the ending. Use day precision unless raw headers independently establish the clock.
- [Sayonara, Seinfeld](https://groups.google.com/g/alt.tv.seinfeld/c/M4pg0R8wRnU): May 15, 1998 contemporary criticism visible in search output; subsequent direct fetch hit 429.
- [Last Epidsode was not so bad!](https://groups.google.com/g/alt.tv.seinfeld/c/7U4FxDKSZs4): May 20, 1998 discussion and defense of the finale, directly readable in this pass.
- [Seinfeld Finale AIRED in Australia](https://groups.google.com/g/alt.tv.seinfeld/c/pAKqN0EDD9U): August 20, 1998 first-local-airing discussion. It is contemporary for that audience, even though the app's US-only window currently calls it retrospective.
- [SeinFAQ v3.9](https://groups.google.com/g/alt.tv.seinfeld/c/ElDZmFSXYTw): June 1998 period guide useful for discovering old fan-site addresses. A FAQ is contextual material rather than an episode reaction thread.
- [May 15, 1998 Examiner review](https://www.sfgate.com/news/article/ruthless-but-funny-to-the-end-3089730.php): contemporaneous editorial context outside fandom. Keep critic reviews distinct from fan posts.

The downloaded `rec.arts.tv` export does not solve the 1989–1991 gap. A separate [2020 backup item](https://archive.org/details/FULL-USENET-BACKUP-2020-Oct-rec.arts.tv.323620.mbox.7z) exists and its 121,277,616-byte 7z file was verified in metadata, but its post-date coverage was **not** established or downloaded. The title's “FULL” is not proof of historical completeness.

## Leads investigated, with honest limits

| Route | Evidence / access | How to use it |
| --- | --- | --- |
| [UTZOO mirror](https://shiftleft.com/mirrors/utzoo-usenet/) | Live index, downloadable tape files; `news135f1.tgz` fetched and scanned, no matching TV-group paths in that shard | Possible 1989–1991 lead, not verified early Seinfeld recovery. Need broader tape-table-of-contents work before downloading indiscriminately. |
| [Original UTZOO IA item](https://archive.org/details/utzoo-wiseman-usenet-archive) | Metadata explicitly says the collection was removed; only listings/checksums and related files remain | Do not recommend this URL as an available corpus. [SourceForge](https://sourceforge.net/projects/utzoo/files/) lists a separate mirror, not audited here. |
| [South Park Cows](https://southparkcows.com/links.html) | Live old-style link directory with reviews/message-board/Scriptorium links | Useful historical domain discovery. Individual review dates and recoverable forum pages remain unverified. |
| [Television Without Pity archive](https://twoparchive.com/) | Live archive index for recaps/reviews | Article recovery is not proof that the original discussion boards survived; these four shows' original threads were not verified here. |
| IMDb / MovieChat / Filmboards | General archive leads surfaced in search | No verified original-era sample for these four shows collected; do not present as established coverage. |
| Sitcoms Online / Seinology / Seinfeld fan sites | Useful late/repeat-era discovery routes | A 2000s Seinfeld thread is not automatically original-run discourse. No independent pre-1998 corpus established in this pass. |
| AOL, Prodigy, CompuServe, Yahoo Groups, IRC logs | Potential historical communities, no verified relevant corpus recovered | Requires concrete archived messages/export evidence; their historical existence is insufficient. |
| Reddit / modern rewatch threads | Often useful leads to old URLs | Modern recollections excluded as evidence of what people said in 1992/1998/1999. |

## Collection order and project integration

1. **Use what is now local.** Review and thread the new 1999 Family Guy messages, the Simpsons satellite group, and 1990s `rec.arts.animation`; extract capsule reviews with production codes and honest date uncertainty. Keep all raw sources immutable.
2. **Expand the official South Park rescue.** Recover forum/season indexes, enumerate episode topic IDs, then collect their complete page offsets. The base CDX indexes are already local. Filter topic spam before paying for classification.
3. **Recover missing 1990s Simpsons main-group threads.** Search production codes plus episode title and original air-date windows. Use known capsule contributors and crossposted Message-IDs as joins. Treat Google rate limits as an access limitation, not an invitation to aggressive retries.
4. **Add Toonzone and No Homers when reproducible access is available.** Start from the talkback indexes instead of sitewide crawling; preserve canonical thread/post IDs across Toonzone domain changes and XenForo migrations. Current 403 probes are documented.
5. **Target Seinfeld's actual holes.** Audit coverage by month and episode for 1989–1992 and the low-volume 1995 slice. Seek a demonstrably earlier `rec.arts.tv` export, rather than another giant export with the same late coverage.
6. **Build source-aware ingestion as a separate implementation task.** The current registry maps one show to one newsgroup; the new corpus requires multiple sources per show and explicit source provenance. Do not shoehorn forum timestamps, capsule documents and Usenet posts into indistinguishable records.

Proposed per-record evidence fields: source/community, original thread and post IDs, original URL, archived URL/WARC pointer, original date string, normalized date, date precision, known timezone/region, capture date, retrieval date, checksum, episode candidate, attribution evidence, pre-air/first-US-air/first-regional-air/repeat/retrospective/unknown context, and duplicate source references. This is a research recommendation, not an implemented schema change.

The existing `live|retro` relation based on **thread start** is insufficient for threads spanning anticipation, broadcast and years of replies. A capsule review may have no individual timestamp. A thread opening before broadcast may contain the best actual live reactions several pages later. Classify timing per message and retain the current thread relation only as a coarse navigation aid until that behavior is designed.

## Verification and limitations

- Internet Archive ZIPs and base CDX files were checked against metadata sizes and SHA-1; collection manifests record SHA-256 for successful local artifacts. ZIP extraction read every selected member to completion.
- All 91 selected South Park WARC ranges passed HTTP range-length checks and gzip decompression. Post counts were computed from post-author blocks, not from profile join dates.
- All five additional mboxes were streamed for counts/date coverage. Candidate files were compared by Message-ID with the four existing local show archives. Audit's slash-separated date-only support was checked against real export headers.
- Actual February 1, 1999 Family Guy reaction bodies were inspected. Web examples were distinguished between directly readable pages, search-visible evidence, metadata-only leads and failed direct-download probes.
- `bun run typecheck` passed. No production application code, database, source registry or deployment changed.
- Missing capsule: `https://simpsonsarchive.com/episodes/7F76.html` returned 404. A full Google Groups, No Homers or Toonzone scrape was not achieved. Other-source replies absent from the keyword subset may still exist in the retained full mboxes.
- Public availability is not itself a reuse license. The research collection preserves originals locally; any public republication should retain source attribution and the project's existing address-redaction behavior. Do not commit raw mboxes or raw forum/capsule bodies.
