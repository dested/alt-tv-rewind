# alt.tv.rewind — UI / Visual Language

> Source of truth for how this looks and feels. Follow it for anything visual.
> Keep it current as part of finishing a UI change — same discipline as cliffnotes.
> v3 (2026-09-21): one theme (paper), two inks, transcript layout for threads, ruled lists instead of cards.

## North star

**A 1996 TV Guide feature, printed in two inks on cream paper, that happens to contain the whole newsgroup.** Editorial and confident. Big serif display type, a hot red-orange for the masthead and live signal, a deep print blue for everything you can click, generous whitespace, hairline rules. The nostalgia is in the *print* — two-ink layout, hanging metadata, ruled listings — never in cosplay (no terminals, no pixel fonts, no scanlines, no drop shadows, no dark mode).

There is exactly one theme. No toggle, no `prefers-color-scheme`, no `.dark`. The paper is the brand.

Two registers, kept distinct by typeface:

1. **The frame** — our voice. Navigation, meta, tabs, tables, charts, recaps. Inter, small, muted by default.
2. **The posts** — their voice. Newsreader at reading size, unwrapped into paragraphs, quotes folded, signatures dimmed. We change the typesetting, never the words.

## Hard rules from the owner

- **No eyebrows.** Never a kicker/label/overline above a heading. Meta goes **below** the heading. (A big episode code set *beside* a title on the same line is a numeral, not an eyebrow — allowed.)
- **No terminal periods in headings.**
- **Emoji only as category glyphs** from `src/lib/taxonomy.ts`.
- **Posters by display name only.** No address anywhere — the parser redacts bodies, quotes, signatures and attributions; an attribution that is only an address becomes "Quoted text".
- **No monospace for prose.** Only parser-detected preformatted content.
- **No nesting indentation in threads.** Replies are shown by the "↩ name" link in the gutter, never by indenting.

## Tokens

Single `:root` in `src/styles/app.css`, exposed via `@theme inline`. oklch everywhere. **Delete the `.dark` block, the `dark` custom variant, `src/lib/theme.ts`, `src/components/theme-toggle.tsx`, the pre-paint theme script in `index.html`, and every `dark:` class.** `color-scheme: light` on `:root`; `<meta name="theme-color">` = the paper hex `#f7f3ec`.

| Token | Value | Use |
| --- | --- | --- |
| `--background` | `oklch(0.965 0.012 85)` cream paper | page |
| `--card` | `oklch(0.985 0.008 85)` | inset panels only (quote panels, pre blocks use `--secondary`) |
| `--foreground` | `oklch(0.2 0.02 60)` warm ink | text |
| `--muted-foreground` | `oklch(0.47 0.02 60)` | meta, captions |
| `--secondary` / `--muted` / `--accent` | `oklch(0.925 0.014 82)` | inactive tabs, `pre` background, quote panels |
| `--border` | `oklch(0.86 0.016 80)` | hairlines and rules |
| `--rule` | `oklch(0.2 0.02 60)` | the *heavy* rules: 2px under the masthead nav, 1.5px above section headings (see below) |
| `--brand` | `oklch(0.6 0.2 32)` hot red-orange | masthead stripe, live signal (air-date ticks, reaction bars, active tab, `<mark>`), "loved it" |
| `--link` | `oklch(0.42 0.11 245)` print blue | links, poster names, the "↩ name" reply pointer, reply rails, focus ring |
| `--link-soft` | `oklch(0.42 0.11 245 / 12%)` | link hover background, blue tints |
| `--destructive` | `oklch(0.55 0.2 27)` | "hated it", errors |
| `--radius` | `0.375rem` | controls and chips only; **no rounded cards** (there are no cards) |

Poster avatars: `hue = posterHue(displayName)`; fill `oklch(0.87 0.06 hue)`, text `oklch(0.34 0.09 hue)`. The only hue outside brand/link, and it encodes identity.

Never hardcode hex or Tailwind palette colors. Add a token if one is missing.

## Typography

Self-hosted variable fonts (already installed; imported in `app.css`): `@fontsource-variable/newsreader/opsz.css` + `opsz-italic.css` (`'Newsreader Variable'`) and `@fontsource-variable/inter/index.css` (`'Inter Variable'`). `font-serif` = Newsreader → Georgia; `font-sans` = Inter → system-ui. `font-optical-sizing: auto` on serif.

| Role | Class | Notes |
| --- | --- | --- |
| Wordmark | `font-serif text-2xl font-semibold tracking-tight` | `alt.tv.rewind` |
| Page title | `font-serif text-5xl font-semibold leading-[1.05] tracking-tight text-balance` | one per page; episode title `text-6xl` on `md` |
| Episode numeral | `font-serif text-5xl md:text-6xl font-light tracking-tight text-brand tabular-nums` | "S07 E24" set on the same baseline row as the title, left of it |
| Thread subject as title | `font-serif text-4xl font-semibold leading-[1.1] tracking-tight text-balance` | `Re:` stripped |
| Thread subject in a list row | `font-serif text-xl font-medium leading-snug` | |
| Section heading | `font-serif text-2xl font-semibold tracking-tight` **preceded by a 1.5px rule** (`border-t-[1.5px] border-rule pt-3`) | the heavy rule above each section is the signature device of the listing pages |
| Meta line | `text-sm text-muted-foreground` | below titles; segments separated by ` · ` |
| Post body | `.post` = `font-serif text-[1.125rem] leading-[1.6]`, paragraphs `space-y-3`, `max-w-[66ch]` | reading register |
| Gutter name | `font-sans text-sm font-semibold text-link` | transcript left column |
| Gutter date / pointer | `font-sans text-xs text-muted-foreground` / `text-link` | |
| Folded quote chip | `font-sans text-xs text-muted-foreground` | "Quoting Mark Collins · 5 lines" |
| Expanded quote | `.post-quote` = `bg-secondary rounded-md px-4 py-3 text-[1rem] text-muted-foreground` | |
| Signature | `font-sans text-xs text-muted-foreground/80 whitespace-pre-line` | ≤ 4 lines |
| Preformatted | `.post-pre` = `font-mono text-[12.5px] leading-[1.45] bg-secondary rounded-md p-3 overflow-x-auto` | |
| Recap lede | `font-serif text-2xl leading-snug max-w-[30em]` with a **drop cap** (`first-letter:float-left first-letter:font-serif first-letter:text-6xl first-letter:leading-[0.8] first-letter:pr-2 first-letter:text-brand`) | |
| Pull quote | `font-serif italic text-2xl leading-snug` | opening mark in `text-brand`; attribution `font-sans text-xs text-muted-foreground` |
| Links | `text-link underline-offset-2 hover:underline` | never `text-foreground hover:underline` |
| Tables | `text-sm`; `th` `text-xs font-medium text-muted-foreground` (never uppercase) | |

## Layout & page anatomy

**Shell** (`src/app/layout.tsx`): `<header>` with `border-t-4 border-brand` on top; inside, a `max-w-5xl` row: wordmark · `/` · show name (`text-link`) · People · right: pill search (`bg-secondary rounded-full h-9 pl-9`), Sign out (admin). Under the row a `border-b-2 border-rule` (heavy ink rule) — masthead done. Main `max-w-5xl px-6 py-10`. Footer: hairline + one muted sentence. **No theme toggle.**

**Thread** `/:show/thread/:slug` — two views, switched by `?view=` (default transcript; `view=tree` for reply chains). The switcher sits on the top rule line, right-aligned: two pills styled exactly like `FilterTabs` ("Transcript" · "Reply chains"), the post count muted on the left. The URL param is the state (SSR-safe, shareable, no hydration flip); nothing is stored client-side.

The transcript view:

1. Title (serif `text-4xl`), then meta line: episode chip (`inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs text-link hover:bg-link-soft`, text "S04E01 The Trip (1)" + `live`/`retro` muted) · `formatDateTime(startedAt, startedDateOnly)` · `relativeToAir` · "5 posts by 5 posters". Chips row. Summary `text-sm text-muted-foreground max-w-[66ch]`; prediction claim serif italic.
2. A 1.5px rule, then the messages in **tree order (depth-first, as `buildTree` yields), flat**:
   `<article id="m{id}" className="grid gap-x-6 py-6 sm:grid-cols-[11rem_1fr] border-b last:border-b-0">`
   - Left gutter (`sm:text-right`): `Avatar` (28px, inline on `sm:` as a block above the name; `sm:ml-auto`), name link (`text-link font-semibold text-sm`), `<time className="block text-xs text-muted-foreground">` (`formatDateTime(postedAt, dateOnly)`), and when depth > 0 an `<a href="#m{parentId}" className="block text-xs text-link">↩ {parent name}</a>`. Below `sm` the gutter collapses to one inline row (avatar · name · time · pointer).
   - Right: `<MessageBody>` in `.post`.
   - A message that is the target of an anchor (`:target`) gets `bg-link-soft` on the article (CSS `article:target { background: var(--link-soft) }`), so "↩ name" clicks visibly land.
3. No collapse toggles, no rails, no indentation. Long threads just scroll; the truncation note stays.
4. Admin "Fix episode" panel under the meta line when a session exists.

The reply-chains view (same `<article id="m{id}">` ids, so anchors work in both):

1. Each message is a compact stack: header row `flex flex-wrap items-baseline gap-x-2` — `Avatar` 22px · name link · `<time>` muted xs · when it has replies a `text-link text-xs` button ("− collapse" / "+ 12 replies"); body `MessageBody` below (`mt-1.5`).
2. Children nest inside `ml-[0.6875rem] border-l pl-5` (rail centered under the avatar). Indentation stops at depth 6 — deeper replies keep their order but no further rail. That is the whole indent budget; never widen it (owner: "too far indented by a lot").
3. Collapse is component state only, kept while switching views; no "↩ name" pointer here — the rail carries the relationship.

**Episode** `/:show/:episode`:

1. Header grid `md:grid-cols-[1fr_22rem] gap-8 items-end`: left — a row with the **episode numeral** ("S07 E24", brand, light weight) and the title on one baseline (`flex flex-wrap items-baseline gap-x-5`), then the meta line ("Aired Thursday, May 16, 1996 · NBC · 22 min"); right — the still, `aspect-video object-cover` with `border border-border` (a thin print frame), no radius. When no still, the left spans.
2. Recap lede with drop cap (fallback: TVMaze summary `text-muted-foreground max-w-[62ch]`, no drop cap).
3. Stat row: `flex flex-wrap gap-x-10 gap-y-3`, value `font-serif text-3xl font-semibold tabular-nums`, label `text-xs text-muted-foreground` underneath. No cards.
4. Reaction-by-day chart (brand bars) with caption.
5. Section "The morning after" (heavy rule above), filter tabs (`rounded-full` pills; active `bg-foreground text-background`; others `text-muted-foreground hover:bg-secondary`), then the **thread list as ruled rows** (`ThreadRow`, see Components) — not cards.
6. Section "Best of the morning after": pull quotes in a two-column `md:grid-cols-2 gap-x-10 gap-y-8`, each `<blockquote>` with no border: `<p className="font-serif text-2xl italic leading-snug"><span className="text-brand">“</span>…</p>` + `<footer className="mt-2 text-xs text-muted-foreground">— Mark Collins, the next day · <Link className="text-link">subject</Link></footer>`.
7. Section "Over the years": rows. Prev/next as `text-link`.

**ThreadRow** (replaces the card everywhere — episode lists, poster page, search results shell): `<article className="grid gap-x-6 py-4 sm:grid-cols-[9rem_1fr] border-b">`; left gutter `text-xs text-muted-foreground sm:text-right`: `relativeToAir` on one line, `plural(posts)` on the next; right: subject link (`font-serif text-xl font-medium leading-snug text-foreground hover:text-link`), then meta line (`starter (text-link) · N posters`), then chips, then summary `text-sm text-muted-foreground max-w-[66ch]`. Lists wrap rows in `<div className="border-t">`.

**Show** `/:show`: header `flex gap-8 items-end` (poster `w-32 border border-border`, title `text-5xl`, meta, archive line), stat row, then sections with heavy rules: "Every post, every night" (timeline), "Seasons" (table), "Most discussed" (episode grid — `EpisodeCard` becomes a frameless tile: still with `border`, code+title serif below, one stat line), "Loved then, hated then", "Then vs now", "Catchphrases".

**Home** `/`: masthead-scale title "What Usenet said the morning after" (`text-5xl`), one-sentence premise, then shows as a ruled list of rows (poster `w-16 border`, name serif `text-2xl`, years · network · "157K posts · 1992–2013 · alt.tv.seinfeld").

**Season / Search / People / Poster**: same type scale, heavy-rule section headings, ruled rows/tables, `text-link` links. Search snippets in `.post text-[1rem]` with `<mark>`.

## Components

| Component | File | Notes |
| --- | --- | --- |
| `Avatar` | `src/components/avatar.tsx` | 22/28/36px monogram, per-poster hue via `posterHue` |
| `MessageBody` | `src/components/message-body.tsx` | renders `parseMessage` blocks; quote chips (`Quoting {name} · n lines` / `Quoted text · n lines`) |
| `ThreadRow` | `src/components/thread-row.tsx` | ruled list row (replaces `ThreadCard`; delete `thread-card.tsx`) |
| `Badge` | `src/components/badge.tsx` | `rounded-md px-2 py-0.5 text-xs font-medium`; neutral `bg-secondary`, brand `bg-brand/12 text-brand`, bad `bg-destructive/12 text-destructive`, outline `border text-muted-foreground` |
| `FilterTabs` | `src/components/filter-tabs.tsx` | pills as above |
| `EpisodeCard` | `src/components/episode-card.tsx` | frameless tile |
| `StatRow` / `StatLine` | | serif values, sans labels, no boxes |
| Charts | `volume-timeline`, `reaction-curve`, `then-vs-now`, `sparkline` | unchanged rules; single-theme colors |
| Icons | `lucide-react` | affordances only |

## Charts

One axis, thin marks, recessive grid, hover tooltip, text in text tokens, hand-rolled SVG identical on server and client. Reaction chart per calendar day (−1…+14).

## States

- **Loading** (client nav only): `<p className="text-muted-foreground text-sm">Loading…</p>`.
- **Empty**: one muted sentence with the reason.
- **Pending**: button disabled + label swap.
- **Error**: root `ErrorBoundary`; 404 says what wasn't found.

## Voice / copy

Terse, specific, lowercase wordmark, sentence case elsewhere. Editorial not marketing.

## Don'ts

- ❌ Dark mode, theme toggles, `dark:` classes, `prefers-color-scheme`.
- ❌ Cards with borders on all four sides for lists; rounded corners on content blocks; shadows.
- ❌ Indenting replies; collapse controls in the transcript.
- ❌ Monospace prose; raw `>` ladders; rendering a body without the parser.
- ❌ Eyebrows; periods at the end of headings; uppercase tracking labels.
- ❌ `brand` on anything that isn't live signal or the masthead; `link` on anything that isn't interactive or a reply pointer.
- ❌ Poster emails anywhere.
