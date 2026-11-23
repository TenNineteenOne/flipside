# Flipside

Flipside is a music-discovery web app (Next.js 16, React 19, Supabase). You sign in with a
username only; there is no Spotify login. It builds one page, the Feed: a stack of artist
cards found by walking Last.fm's similar-artist graph from the artists and genres you pick,
each with a 30-second preview (iTunes first, Spotify as a fallback). You like, pass or save
artists, and can sync listening history from Last.fm or stats.fm.

## Run it

```bash
npm install
cp .env.example .env.local   # then fill in the values; comments in the file explain each
npm run dev                  # http://localhost:3000
npm test                     # vitest; needs no env vars or network
```

`npm run build` runs the tests first and stops if any fail. Vercel uses the same command, so
a failing test blocks a deploy.

## Branches

Work lands on `Nick`, which Vercel builds as a preview. Production deploys from `main`.

## Where to read next

- `AGENTS.md`: rules for anyone (human or AI) changing this code.
- `docs/wiki/index.md`: how the app works, checked against the code.
- `docs/archive/`: old plans and mockups. Historical only.
