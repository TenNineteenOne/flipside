<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# How this app works — read the wiki first

Before reasoning about architecture (auth, data flow, the recommendation engine, external
integrations), read **`docs/wiki/index.md`** — a cross-linked, code-verified map of the
whole app. Don't infer architecture from training priors (e.g. "music apps log in with
Spotify" — flipside does NOT). Key entry points:

- `docs/wiki/architecture-overview.md` — the big picture + generation flow
- `docs/wiki/generation-engine.md` — recommendations (Feed, incl. the Wander farther far pool)
- `docs/wiki/music-providers.md` / `external-apis.md` — Spotify / Last.fm / iTunes / stats.fm
- `docs/wiki/spotify-dependency.md` — what Spotify is (and isn't) load-bearing for
- `docs/wiki/data-model.md` — Supabase schema

If you change behavior, update the relevant wiki page and its `updated:` date.
