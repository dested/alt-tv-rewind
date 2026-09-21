# alt.tv.rewind

What Usenet said the morning after. `alt.tv.seinfeld`, `alt.tv.simpsons`, `alt.tv.friends` and friends, lined up against the original air dates — pick an episode and read the reaction as it happened, then everything posted about it in the decades since.

- Every thread is attributed to an episode (air-date window + title matching, then a calibrated model pass) and tagged **live** (posted within days of the first airing) or **retro**.
- Threads are bucketed: 🔥 controversial · 😂 loved it · 😡 hated it · 🤯 predictions (graded against what actually happened) · 🧠 theories · questions.
- Per episode: posts per day after airing, the biggest threads, the best pull quotes, a Usenet score next to today's TVMaze rating.
- Per show: the whole run's post volume with every air date ticked, loved-then/hated-then, then-vs-now, catchphrase timelines.
- Full-text search across the archive; people pages (display names only — no email address is stored or shown).

Stack: Bun · Express 5 + Vite SSR · React Router 7 · tRPC 11 · Prisma 7 + Postgres · Tailwind 4. Classification runs on [Jev](https://typesafe.ai) (TypeSafe AI); summaries and prediction grading on Claude Haiku 4.5; episode recaps on Claude Opus 5.

## Run it

Requires Bun ≥ 1.3 and Postgres.

```bash
bun install
cp .env.example .env        # DATABASE_URL, BETTER_AUTH_SECRET, PORT=7485, API keys for the LLM stages
bun run db:deploy           # migrations only — never `prisma db push` here (FTS trigger)
bun run pipeline add-show alt.tv.seinfeld --name "Seinfeld"
bun run dev                 # → http://localhost:7485
```

`add-show` downloads the archive.org mbox (`usenet-alt/<group>.mbox.zip`), resolves the show on TVMaze, registers it in `data/shows.json`, and runs the pipeline: parse → thread → episodes → attribute → classify → enrich → load → stats → recap. Every stage checkpoints to `data/work/<slug>/` and is resumable; `bun run pipeline ingest <slug> --from <stage>` / `--only a,b` / `--force` re-run pieces. Without `TYPESAFE_API_KEY` / `ANTHROPIC_API_KEY` the model stages are skipped and the site runs on heuristics alone.

Per-show curation lives in `data/shows/<slug>/`: `aliases.json` (what fans called an episode), `phrases.json` (catchphrases to chart).

## Scripts

| script                                           | what                                                               |
| ------------------------------------------------ | ------------------------------------------------------------------ |
| `bun run dev`                                    | dev server, SSR + HMR on :7485                                     |
| `bun run pipeline …`                             | `ingest <slug>` · `add-show <group> --name …` · `download <group>` |
| `bun test`                                       | pipeline unit tests                                                |
| `bun run typecheck`                              | `tsgo --noEmit`                                                    |
| `bun run build` / `start`                        | production bundle / server                                         |
| `bun run db:migrate` / `db:deploy` / `db:studio` | Prisma migrations / Studio                                         |

The developer map is `cliffnotes.md`; visual rules are `ui.md`; settled choices are `decisions.md`.

## Data

Archives come from the Internet Archive's Usenet collection (`https://archive.org/download/usenet-alt/<group>.mbox.zip`). Episode metadata is from TVMaze and snapshotted into the repo. Archives and pipeline checkpoints are gitignored.
