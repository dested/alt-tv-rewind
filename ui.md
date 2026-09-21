# alt.tv.rewind — UI / Visual Language

> Source of truth for how this looks and feels. Follow it for anything visual.
> Keep it current as part of finishing a UI change — same discipline as cliffnotes.

## North star

**An archive re-read as an editorial, with the newsgroup's own voice left intact.** Two registers, never blended:

1. **The archive frame** — warm paper neutrals, hairline borders, restrained typography, lots of air. Linear/Vercel-style discipline (borders not shadows, muted by default, ink for signal). This is _our_ voice: headings, meta lines, charts, navigation, recaps.
2. **The Usenet voice** — anything that came off the wire (message bodies, quoted text, signatures) renders in **monospace with preserved whitespace**, quote levels as left rails. We never reflow, prettify, or "modernize" a 1996 post. ASCII art aligns. `.usenet` in `app.css` is the class.

One accent, `brand` (hot red-orange), reserved for **live signal**: air-date ticks on the timeline, the reaction curve, active tabs, "loved it" badges, `<mark>` in search snippets. Everything else is ink and paper. If brand shows up on a decorative element, it's wrong.

Failure modes: (a) generic dashboard — cards with big numbers and no story; (b) retro cosplay — green-on-black terminal, pixel fonts, CRT scanlines. Neither. The paper is calm so the 1996 text can be loud.

## Hard rules from the owner

- **No eyebrows.** Never a kicker/label/overline above a heading ("SEASON 7 · EPISODE 24", "01 · The tools"). Meta lines go **below** the heading, never above.
- **No terminal periods in headings.** "The morning after" not "The morning after." Body copy keeps its periods.
- **Emoji only as category glyphs** (kind, sentiment, prediction outcome, the episode-page filter tabs — the maps in `src/lib/taxonomy.ts`). Nowhere else. No emoji in prose, buttons, or empty states.
- **Posters by display name only.** Never render an email address, never link to one.

## Tokens

CSS variables in `src/styles/app.css` (`:root` light, `.dark` dark), exposed via `@theme inline`. oklch everywhere. Both themes must look right — check both.

| Token                | Class                          | Use                                                        |
| -------------------- | ------------------------------ | ---------------------------------------------------------- |
| Background           | `bg-background`                | page canvas — warm paper (light) / warm charcoal (dark)    |
| Card                 | `bg-card`                      | thread cards, episode cards, panels                        |
| Foreground           | `text-foreground`              | headings, primary text, chart bars (with opacity)          |
| Muted fg             | `text-muted-foreground`        | meta lines, secondary text, axis labels, quoted text       |
| Secondary            | `bg-secondary`                 | neutral badges, subtle surfaces, inactive tabs on hover    |
| **Brand**            | `text-brand` `bg-brand` `border-brand` | live signal only (see above); `bg-brand/10` for tints |
| Destructive          | `text-destructive`             | "hated it" badges, errors                                  |
| Border / Input       | `border`, `border-input`       | hairlines, field borders, quote rails                      |
| Ring                 | `ring-ring`                    | focus (`focus-visible:ring-[3px]`)                         |

Never hardcode hex or Tailwind palette colors (`bg-orange-500`). Add a token if one is missing.

## Typography

System sans for the frame; system mono for the wire.

| Role                | Class                                              | Notes                                                        |
| ------------------- | -------------------------------------------------- | ------------------------------------------------------------ |
| Page title          | `text-3xl font-bold tracking-tight` (`text-4xl` on episode + home) | one per page                                     |
| Meta line           | `text-muted-foreground text-sm`                    | directly **below** the title: "Season 7 · Episode 24 · Aired Thursday, May 16, 1996 · NBC" |
| Section heading     | `text-xl font-semibold tracking-tight`             | "The morning after", "Over the years", "Best of the morning after" |
| Thread subject      | `font-medium leading-snug`                         | the original Subject line, sans, `Re:` stripped               |
| Body                | `text-sm`                                          | recaps, summaries                                            |
| Editorial lede      | `text-lg leading-relaxed`                          | the episode recap, max ~60ch measure                         |
| Wire text           | `.usenet` (`font-mono text-[13px] leading-[1.5] whitespace-pre-wrap`) | message bodies                                |
| Numbers             | `tabular-nums`                                     | anywhere counts align (tables, stat rows)                    |

Dates: always through `src/lib/format.ts` (fixed `en-US` + `America/New_York`). Show "ET" once per page, not on every timestamp. Relative-to-air phrasing (`relativeToAir`) is the star: "the next morning", "37 minutes after the credits", "3 years later".

## Spacing, shape, elevation

| Token           | Value                                                                       |
| --------------- | --------------------------------------------------------------------------- |
| Page container  | `mx-auto max-w-5xl px-6 py-8` (from `layout.tsx`); thread reader narrows to `max-w-3xl` inside |
| Rhythm          | `space-y-10` between page sections, `space-y-4` within, `space-y-2` fields |
| Radius          | `--radius: 0.5rem`; `rounded-md` controls/badges, `rounded-lg` cards       |
| Elevation       | `shadow-xs` on inputs, none on cards (borders do the work)                  |
| Card            | `bg-card rounded-lg border p-4` (+ `hover:border-foreground/30 transition-colors` when the whole card is a link) |

## Layout & page anatomy

**Shell** (`src/app/layout.tsx`): bordered header — `alt.tv.rewind` wordmark · `/ seinfeld` · People · (right) search box · Sign out (admin only) · theme toggle. Footer with sourcing line. Main column `max-w-5xl`.

**Home** `/`: title + one-sentence premise, then a grid of show cards (`md:grid-cols-2 lg:grid-cols-3`): poster image (`aspect-[2/3]`, `object-cover`, `rounded-md`), name, years, network, then a muted stat line "157K posts · 1992–2013 · alt.tv.seinfeld".

**Show** `/:show`: header row (poster left `w-28`, title, meta line, archive stat line), then **the volume timeline** full width, then "Seasons" (compact table: season, years, episodes, live posts bar, retro posts), then "Most discussed" episode cards (`md:grid-cols-4`), then "Then vs now" scatter/dumbbell (Usenet score vs TVMaze rating), then "Catchphrases" (small multiples of monthly sparklines with "first said <date> in <thread>").

**Season** `/:show/season/:n`: title "Season 7", meta line; table of episodes (code, title, air date, live posts as inline bar with count, retro posts, Usenet score) — rows link to episodes.

**Episode** `/:show/:episode` — the hero page:
1. Still image (`aspect-video`, `rounded-lg`, full column width, `object-cover`) — omit the block entirely when null.
2. Title (`text-4xl`), meta line **below**.
3. Editorial lede: the recap in `text-lg leading-relaxed` with a slim `border-l-2 border-brand pl-4`. Fallback when null: TVMaze summary in normal body text (no rail).
4. Stat row (`flex flex-wrap gap-x-8 gap-y-2`, each `tabular-nums` value + muted label): live threads · posts · posters · Usenet score · TVMaze today. No cards. No icons.
5. **Reaction curve** (`ReactionCurve`): hourly bars −6h…96h, brand fill; x ticks at 0 ("aired"), 12h, 24h, 48h, 72h; hover tooltip. Height 96px. Omit when empty.
6. "The morning after": filter tabs (All · 🔥 Controversial · 😂 Loved it · 😡 Hated it · 🤯 Predictions · 🧠 Theories · ❓ Questions) — segmented row, active tab `bg-foreground text-background`, others `text-muted-foreground hover:bg-secondary`; counts in the tab when known. Then `ThreadCard` list; "Show more" button loads the next page.
7. "Best of the morning after": pull quotes as a 2-col grid of `blockquote.usenet` with `— displayName, the next morning` attribution.
8. "Over the years": retro threads, same card, sorted by size.
9. Prev / next episode links, split left/right.

**Thread** `/:show/thread/:id`: subject as title, meta line (episode chip linking to the episode · started `formatDateTime` · `relativeToAir` · N posts by M posters), badges row (kind, sentiment, prediction outcome), LLM summary in muted text. Then the **tree**: each message is `article` with a header line (`font-medium` display name linking to the poster · muted `formatDateTime` · depth-1+ shows "↳ in reply to <name>" linking `#m<parentId>`) and the body in `.usenet`. Nesting: indent `ml-4 border-l pl-4` per level, capped at 6 visual levels. Quote lines (`>`) get `.usenet-quote` (nested `>>` nests the class); everything after `\n-- \n` gets `.usenet-sig`. A "collapse replies" toggle per subtree (count shown when collapsed). Permalink `id="m{id}"`. Admin-only inline "Fix episode" select renders under the meta line when a session exists.

**Search** `/:show/search?q=`: large input on top (prefilled), filter row (season select, year from/to), results grouped by thread: thread subject + episode chip + N posts, then up to 3 hit snippets in `.usenet` with `<mark>` (snippet markers U+0001/U+0002 from the API become `<mark>` after HTML-escaping — never inject raw snippet HTML).

**People** `/:show/people`: two columns on `md`: "Most prolific" table (name, posts, threads started, active years) and "The prophets" (name, hit rate as `tabular-nums` %, n predictions).

**Poster** `/:show/people/:id`: name as title, meta line (N posts across shows · active 1994–2001), byYear bars (tiny inline SVG), "Threads started" `ThreadCard` list, "Predictions" list with outcome badges.

## Components

| Component          | File                                   | Notes                                                                                       |
| ------------------ | -------------------------------------- | ------------------------------------------------------------------------------------------- |
| `Badge`            | `src/components/badge.tsx`             | variants neutral / brand / bad / outline; used for kind, sentiment, outcome, live/retro      |
| `ThreadCard`       | `src/components/thread-card.tsx`       | subject (link to thread), meta line (starter · `relativeToAir` or `formatDate` · N posts · M posters), badges, one-line summary; whole card is not a link — the subject is |
| `EpisodeCard`      | `src/components/episode-card.tsx`      | still (`aspect-video`) + code · title + one stat line                                       |
| `VolumeTimeline`   | `src/components/volume-timeline.tsx`   | SVG; weekly bars `fill-foreground/60`; season bands `fill-foreground/[0.04]`; air-date ticks `stroke-brand`; hover crosshair + tooltip (mounted client-side only); click → nearest episode within 7 days |
| `ReactionCurve`    | `src/components/reaction-curve.tsx`    | SVG hourly bars `fill-brand`, day dividers `stroke-border`, hour-0 label "aired"           |
| `Sparkline`        | `src/components/sparkline.tsx`         | 1px `stroke-foreground` line, no axes; catchphrases + poster years                          |
| `FilterTabs`       | `src/components/filter-tabs.tsx`       | segmented control over `EPISODE_FILTERS`                                                     |
| `MessageBody`      | `src/components/message-body.tsx`      | splits quote levels / signature into `.usenet-quote` / `.usenet-sig`; escapes; linkifies nothing |
| shadcn primitives  | `src/components/ui/*`                  | Button, Card, Input, Label (no `asChild`)                                                    |
| Icons              | `lucide-react`                         | only for UI affordances (search, chevrons); never as content decoration                      |

## Charts

Follow the dataviz rules: **one axis per chart, thin marks, recessive grid, tooltip on hover, text in text tokens never series color.** Single-series charts need no legend. All charts are hand-rolled SVG (no chart library) and must render identically on the server and client — no `window` reads during render; hover layers mount in `useEffect`/state after hydration.

- Volume timeline: x = time (1992→2013), y = messages per week. Air dates as 1px brand ticks along the baseline; seasons as faint bands; a hovered week shows "Week of May 13, 1996 · 1,204 posts · nearest: S07E24 The Invitations (May 16)".
- Reaction curve: x = hours since air, y = posts per hour.
- Then vs now: x = TVMaze rating today, y = Usenet score at the time; dots `fill-foreground/70`, hover names the episode; the two most extreme "underrated then" / "overrated then" dots are direct-labeled.

## States

- **Loading** (client nav only; SSR always has data): `<p className="text-muted-foreground text-sm">Loading…</p>`.
- **Empty**: one muted sentence with the reason when known — "No live reaction survived for this episode — the archive begins in June 1992." / "Nobody predicted anything about this one." / "No posts match “festivus” in 1993."
- **Pending action**: button disabled + label swap ("Saving…").
- **Error**: root `ErrorBoundary`; 404 page says what wasn't found ("No episode at that address").

## Voice / copy

Terse, specific, lowercase wordmark, sentence case elsewhere. Editorial not marketing: "What alt.tv.seinfeld said the morning after" beats "Explore reactions!". No exclamation marks, no "Discover", no "Dive into". Counts always concrete ("60 posts in 48 hours").

## Don'ts

- ❌ Kicker labels above headings; periods at the end of headings.
- ❌ `brand` on anything that isn't live signal; Tailwind palette colors; hex.
- ❌ Chart libraries; dual axes; legends on single-series charts; numbers on every bar.
- ❌ Reflowing or truncating message bodies in the thread reader (cards may show a one-line summary — never a body excerpt).
- ❌ `dangerouslySetInnerHTML` with anything not escaped first (search snippets are the only HTML, built from escaped text + `<mark>`).
- ❌ Reading `window`/`matchMedia`/theme in render; SSR and client markup must match.
- ❌ Poster emails, anywhere.
