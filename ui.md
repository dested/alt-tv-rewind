# alt.tv.rewind — UI / Visual Language

> Source of truth for how this looks and feels. Follow it for anything visual.
> Keep it current as part of finishing a UI change — same discipline as cliffnotes.
> v2 (2026-09-21): the "wire voice in monospace" register is gone. Posts are prose.

## North star

**A 1996 TV Guide, printed on good paper, that happens to contain the whole newsgroup.** Editorial, warm, legible, quiet. The nostalgia is in the material — paper, ink, a serif with real italics, one hot accent — never in cosplay. What we are _not_: a terminal (no monospace walls, no `>` quote ladders, no near-black), a dashboard (no stat cards, no icon soup), a generic forum.

Two registers, kept distinct by typeface and rhythm:

1. **The frame** — our voice. Navigation, meta lines, tabs, charts, recaps, tables. Set in Inter, small, muted by default; ink for signal.
2. **The posts** — their voice, 1992–2013. Set in Newsreader at reading size, unwrapped into real paragraphs, with quotes folded and signatures dimmed. We change the _typesetting_, never the words. Nothing is truncated, paraphrased, or spell-checked.

One accent, `brand` (hot red-orange, oklch 0.6 0.2 32), reserved for **live signal and the masthead stripe**: air-date ticks, the reaction curve, active tabs, "loved it", `<mark>`, the 2px rule under the header. Everything else is ink and paper.

## Hard rules from the owner

- **No eyebrows.** Never a kicker/label/overline above a heading. Meta lines go **below** the heading.
- **No terminal periods in headings.**
- **Emoji only as category glyphs** from `src/lib/taxonomy.ts`. Nowhere else.
- **Posters by display name only.** No email address is ever rendered — including inside message bodies and signatures (the parser redacts them).
- **No monospace for prose.** Monospace is allowed only for genuinely preformatted content the parser detects (ASCII art, tables, code) and never for a paragraph someone typed.

## Tokens

CSS variables in `src/styles/app.css` (`:root` light, `.dark` dark), exposed via `@theme inline`. oklch everywhere. Both themes must look right — check both.

| Token                                  | Light                              | Dark                                                 | Use                                                             |
| -------------------------------------- | ---------------------------------- | ---------------------------------------------------- | --------------------------------------------------------------- |
| `--background`                         | `oklch(0.975 0.008 85)` warm paper | `oklch(0.21 0.012 60)` warm charcoal — **not black** | page                                                            |
| `--card`                               | `oklch(0.995 0.004 85)`            | `oklch(0.255 0.012 60)`                              | message cards, thread cards, panels                             |
| `--foreground`                         | `oklch(0.18 0.015 60)`             | `oklch(0.93 0.01 80)`                                | ink                                                             |
| `--muted-foreground`                   | `oklch(0.48 0.015 60)`             | `oklch(0.68 0.012 70)`                               | meta, captions, folded quotes                                   |
| `--secondary` / `--muted` / `--accent` | `oklch(0.94 0.012 80)`             | `oklch(0.30 0.012 60)`                               | quote panels, inactive tabs, `pre` background                   |
| `--border`                             | `oklch(0.89 0.012 80)`             | `oklch(1 0 0 / 13%)`                                 | hairlines, reply rails                                          |
| `--brand`                              | `oklch(0.6 0.2 32)`                | `oklch(0.72 0.18 35)`                                | live signal, masthead stripe                                    |
| `--destructive`                        | unchanged                          | unchanged                                            | "hated it", errors                                              |
| `--radius`                             | `0.625rem`                         |                                                      | cards `rounded-xl`, controls `rounded-lg`, chips `rounded-full` |

Poster avatars use a per-poster hue: `hue = hash(displayName) % 360`, fill `oklch(0.86 0.06 hue)` light / `oklch(0.36 0.06 hue)` dark, text `oklch(0.32 0.08 hue)` / `oklch(0.9 0.05 hue)`. This is the only place a hue other than brand appears, and it is data (identity), not decoration.

Never hardcode hex or Tailwind palette colors. Add a token if one is missing.

## Typography

Self-hosted variable fonts, imported once in `app.css`: `@fontsource-variable/newsreader/opsz.css` + `@fontsource-variable/newsreader/opsz-italic.css` (optical-size axis; the family name is `'Newsreader Variable'`) and `@fontsource-variable/inter/index.css` (`'Inter Variable'`). Exposed as `font-serif` (Newsreader → Georgia → serif) and `font-sans` (Inter → system-ui). `font-mono` is the system stack.

| Role                       | Face         | Class                                                                                                                                                                 | Notes                                   |
| -------------------------- | ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| Wordmark                   | serif        | `font-serif text-xl font-semibold tracking-tight`                                                                                                                     | `alt.tv.rewind`, lowercase              |
| Page title                 | serif        | `font-serif text-4xl font-semibold tracking-tight text-balance` (`text-5xl` on episode)                                                                               | one per page                            |
| Thread subject (as title)  | serif        | `font-serif text-3xl font-semibold leading-tight text-balance`                                                                                                        | `Re:` stripped                          |
| Thread subject (in a card) | serif        | `font-serif text-lg font-medium leading-snug`                                                                                                                         |                                         |
| Section heading            | sans         | `text-sm font-semibold tracking-wide text-muted-foreground uppercase`? **No** — uppercase reads as an eyebrow. Use `font-serif text-2xl font-semibold tracking-tight` | "The morning after"                     |
| Meta line                  | sans         | `text-sm text-muted-foreground`                                                                                                                                       | below titles; segments separated by `·` |
| **Post body**              | serif        | `.post` = `font-serif text-[1.0625rem] leading-[1.65]`, paragraphs `space-y-3`, max measure `max-w-[68ch]`                                                            | the reading register                    |
| Folded quote chip          | sans         | `text-xs text-muted-foreground`                                                                                                                                       | "Quoting Mark Collins · 5 lines"        |
| Expanded quote             | serif        | `.post-quote` = `text-[0.95rem] text-muted-foreground border-l-2 pl-4`                                                                                                |                                         |
| Signature                  | sans         | `text-xs text-muted-foreground/80 whitespace-pre-line`                                                                                                                | max 4 lines                             |
| Preformatted               | mono         | `.post-pre` = `font-mono text-[12.5px] leading-[1.45] bg-secondary rounded-lg p-3 overflow-x-auto`                                                                    | only when the parser says so            |
| Recap lede                 | serif        | `font-serif text-xl leading-relaxed` with `border-l-2 border-brand pl-4`, `max-w-[62ch]`                                                                              |                                         |
| Pull quote                 | serif italic | `font-serif italic text-xl leading-snug`                                                                                                                              | attribution in sans `text-xs` below     |
| Numbers                    |              | `tabular-nums`                                                                                                                                                        | tables, stat rows                       |
| Tables / UI body           | sans         | `text-sm`                                                                                                                                                             |                                         |

Dates go through `src/lib/format.ts`. Show "ET" once per page. `relativeToAir` phrasing is the star ("the next morning", "5 days later"); `formatDateTime(iso, dateOnly)` never shows a clock for date-only posts.

## Message rendering — `src/lib/usenet.ts` → `MessageBody`

The parser turns a raw body into blocks; the component renders blocks. **Never render a raw body.**

Blocks:

- `paragraph { text }` — a run of non-blank, non-quote lines **joined with single spaces** (hard wraps removed, internal runs of whitespace collapsed). A run is a paragraph unless it is preformatted (below) or a list.
- `list { items: string[] }` — consecutive lines starting with `- `, `* `, `• `, or `\d+[.)] `; continuation lines (indented, not starting with a marker) join the previous item.
- `pre { text }` — a run is preformatted when ≥2 of its lines start with ≥3 spaces or a tab, or contain ≥3 consecutive internal spaces, or ≥40% of the run's characters are non-alphanumeric (ASCII art, tables, boxes). Whitespace preserved exactly.
- `quote { attribution: string | null, depth, blocks }` — consecutive lines carrying a `>` prefix (`>`, `> `, `>>`, `: ` is _not_ a quote). One level stripped, remainder parsed recursively (max depth 3; deeper collapses into depth 3). `attribution` comes from the line(s) immediately before the quote that match the classic forms — `In article <…> name (Real Name) writes:`, `On <date>, Real Name <addr> wrote:`, `Real Name wrote:`, `name@host (Real Name) writes:` — resolved to the human name (parenthesised name wins; otherwise the words before `wrote|writes|said`), with any address or Message-ID stripped. Attribution lines and lone `...` / `[...]` / `<snip>` / `[snip]` lines are consumed, not rendered.
- `signature { lines }` — everything from a `-- ` line (`--` with optional trailing space) to the end; failing that, a trailing block after the last blank line that is ≤ 6 lines and contains an address, a URL, a phone number, or a rule line. Rule lines (≥ 6 repeated `*-=_~#+.`) are removed; lines left empty after redaction are removed; if nothing remains the block is dropped.

Redaction applies to every text node the parser emits, including inside quotes and signatures: emails `[\w.+-]+@[\w-]+(\.[\w-]+)+` → `[email]`; bang paths `(\w[\w.-]*!){1,}\w[\w.-]*` → `[address]`; Message-IDs `<[^\s<>]+@[^\s<>]+>` → removed. URLs are left as text (most are dead) and are not linkified.

Rendering (`MessageBody`, inside `.post`):

- `paragraph` → `<p>`; `list` → `<ul className="list-disc pl-5 space-y-1">`; `pre` → `<pre className="post-pre">`.
- `quote` → collapsed by default to a chip: `<button className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1">` with a chevron icon and the text **"Quoting {attribution} · {n} lines"** (or "Quoted text · n lines" when no attribution). Clicking expands the quote in place as `.post-quote` (recursively rendered blocks; nested quotes are chips too). State is per message, client-only; SSR renders collapsed. A quote that is the _entire_ message (nothing else but a signature) renders expanded, because otherwise the message is empty.
- `signature` → `<footer className="mt-3 text-xs text-muted-foreground/80 whitespace-pre-line">`, at most 4 lines.

## Layout & page anatomy

**Shell** (`src/app/layout.tsx`): header has a `border-t-2 border-brand` stripe on top and a hairline below. Inside: serif wordmark · `/` · show name · People · (right) search field (`rounded-full`, `bg-secondary`, no shadow) · Sign out (admin) · theme toggle. Main column `max-w-5xl px-6 py-10`. Footer hairline + one muted sourcing sentence.

**Thread** `/:show/thread/:id` — the page that was wrong:

1. Title: subject in serif (`text-3xl`), `Re:` stripped, `text-balance`.
2. Meta line below: episode chip (`rounded-full border px-2.5 py-0.5 text-xs` linking to the episode, "S04E01 The Trip (1)" + a tiny `live`/`retro` word inside the chip in muted) · `formatDateTime(startedAt, startedDateOnly)` · `relativeToAir` · "5 posts by 5 posters".
3. Badges row (kind, sentiment, controversial, prediction outcome) — `rounded-full` chips, sans `text-xs`.
4. Summary (if any) in `text-sm text-muted-foreground max-w-[68ch]`; prediction claim italic serif.
5. **Messages.** Each message is an `<article id="m{id}">` in a two-column grid `grid-cols-[2.25rem_1fr] gap-x-3 py-5`, separated by hairlines (`divide-y`). Left: `Avatar` (36px circle, monogram of the display name's initials, per-poster hue). Right: a header row — poster name (`font-medium`, links to the poster) · `formatDateTime(postedAt, dateOnly)` in `text-xs text-muted-foreground` · when depth > 0, a `text-xs text-muted-foreground` "↩ Mark Collins" linking `#m{parentId}` · right-aligned `text-xs` toggle "4 replies" / "show 4 replies". Below: `MessageBody` in `.post`.
6. **Nesting.** Children render under the parent, indented by `2.25rem + 0.75rem` per level with a `border-l` rail on the child container (`ml-[1.125rem] border-l pl-[1.875rem]` so the rail runs from the parent's avatar centre). Visual depth caps at **4 on ≥sm, 2 below** (`sm:` variants); deeper replies flatten to the cap and rely on the "↩ name" link. Collapsed subtrees show the toggle only.
7. Admin "Fix episode" panel under the meta line when a session exists (unchanged behaviour, restyled to match).

**Episode** `/:show/:episode`: still image `rounded-xl`; serif title `text-5xl`; meta line; recap lede (serif); stat row (sans, `tabular-nums`, no cards); reaction-by-day chart; "The morning after" with filter tabs (`rounded-full` segmented, active `bg-foreground text-background`); `ThreadCard` list; "Best of the morning after" pull quotes as a two-column grid — each is a serif italic quotation `text-xl` with a `text-brand` opening quotation mark, attribution below in sans `text-xs` ("— Mark Collins, the next day · Killing off Susan UNACCEPTABLE"); "Over the years"; prev/next.

**ThreadCard**: `bg-card rounded-xl border p-5`; subject serif `text-lg font-medium` (link); meta line; chips; summary `text-sm`. No body excerpts.

**Home / Show / Season / Search / People / Poster**: keep their structure; apply the type scale (serif titles + section headings, sans everything else), `rounded-xl` cards, `rounded-full` chips, and the token changes. Search snippets render in `.post text-[0.95rem]` with `<mark>`; the snippet text is a fragment, so it is _not_ run through the block parser — just email-redacted.

## Components

| Component                                                                                                                                        | File                                | Notes                                                                                                                                                                                 |
| ------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Avatar`                                                                                                                                         | `src/components/avatar.tsx`         | `size` 28/36; initials (first letters of the first two words, uppercased, falls back to `?`); hue from `posterHue(name)` in `src/lib/usenet.ts`; `aria-hidden` (the name is adjacent) |
| `MessageBody`                                                                                                                                    | `src/components/message-body.tsx`   | renders `parseMessage(body)` blocks; quote fold state via `useState`                                                                                                                  |
| `Badge`                                                                                                                                          | `src/components/badge.tsx`          | `rounded-full`, variants neutral / brand / bad / outline                                                                                                                              |
| `ThreadCard`                                                                                                                                     | `src/components/thread-card.tsx`    | see above                                                                                                                                                                             |
| `EpisodeCard`, `VolumeTimeline`, `ReactionCurve`, `ThenVsNow`, `Sparkline`, `FilterTabs`, `StatRow`, `StatLine`, `PhraseGrid`, `AdminFixEpisode` | unchanged roles; restyled to tokens |
| Icons                                                                                                                                            | `lucide-react`                      | affordances only (search, chevron for quote chips, collapse)                                                                                                                          |

## Charts

Unchanged rules: one axis, thin marks, recessive grid, hover tooltip, text in text tokens, hand-rolled SVG that renders identically on server and client. Reaction chart is per calendar day (−1…+14).

## States

- **Loading** (client nav only): `<p className="text-muted-foreground text-sm">Loading…</p>`.
- **Empty**: one muted sentence with the reason ("No live reaction survived for this episode — the archive begins in March 2000.").
- **Pending action**: button disabled + label swap.
- **Error**: root `ErrorBoundary`; 404 says what wasn't found.

## Voice / copy

Terse, specific, lowercase wordmark, sentence case elsewhere. Editorial not marketing. Counts concrete.

## Don'ts

- ❌ Monospace for anything a person typed as prose; raw `>` ladders; rendering a body without the parser.
- ❌ Kicker labels above headings; periods at the end of headings; uppercase tracking labels (they read as eyebrows).
- ❌ `brand` on anything that isn't live signal or the masthead stripe; Tailwind palette colors; hex.
- ❌ Shadows on cards; pure black or pure white surfaces.
- ❌ Chart libraries; dual axes.
- ❌ Truncating message bodies (cards show summaries, never excerpts).
- ❌ `dangerouslySetInnerHTML` with anything not escaped first.
- ❌ Reading `window`/`matchMedia`/theme in render.
- ❌ Poster emails, anywhere — including bodies, quotes, signatures, attributions.
