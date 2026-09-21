# alt-tv-rewind — Decisions

> Append-only log of choices with rejected alternatives. Never reverse one silently — add a superseding entry.

## 2026-09-11 — Stylesheet is a `<link>` in `index.html`, not a JS import
**Why:** importing `app.css` from `App.tsx` made Vite inject it after the client module graph loaded, so every dev load painted unstyled SSR HTML first. A head `<link>` is render-blocking in dev (Vite serves compiled CSS, HMR swaps the href) and gets hashed into `<head>` by `vite build`. Zero server code.
**Rejected:** collecting CSS from `vite.moduleGraph` in `server.ts` and inlining `<style data-vite-dev-id>` (works, but ~30 lines of dev-only plumbing for the same result).

## 2026-09-11 — Dark mode: `.dark` class + inline pre-paint script + `dark:` markup swaps
**Why:** the tokens already existed under `.dark`; an inline `<head>` script (stored choice → `prefers-color-scheme`) applies the class before first paint, and components render both variants and hide one with `dark:` so SSR and client markup are identical. Binary toggle persisted in `localStorage.theme`; absence means "follow the OS" (tracked live by `followSystemTheme`).
**Rejected:** media-query-only dark mode (no user override); React state / context for the theme (hydration mismatch or a post-mount icon flip); a system/light/dark tri-state (needs a dropdown → radix Slot dependency the template deliberately avoids).

## 2026-09-11 — Vite HMR websocket shares the Express `http.Server`
**Why:** the fixed `hmr.port: 24678` collided whenever two clones of this template ran at once (HMR silently connected to the wrong server and got a 400). `hmr: { server }` means one port, and it survives reverse proxies.
**Rejected:** `PORT + 1` (still a second port; breaks behind proxies), `hmr.port: 0` (Vite does not pick a free port in middleware mode).

## 2026-09-11 — Client-nav loaders prefetch through lazy browser singletons
**Why:** `getBrowserClients()` in `src/lib/trpc.tsx` gives loaders the same `QueryClient` + tRPC options proxy the app renders with, so `dashboardLoader` can `await prefetchQuery` on client navigation — no "Loading…" flash. Lazy so the shared `routes.tsx` allocates nothing during SSR.
**Rejected:** fire-and-forget prefetch (still flickers), creating the clients in `routes.tsx` at module scope (runs on the server too).
