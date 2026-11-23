---
title: Infra & Ops
updated: 2026-11-23
related: [[auth-and-session]], [[api-routes]], [[data-model]]
---

# Infra & Ops

Config, middleware, cron, color extraction, and operational notes. Deployed on Vercel;
branching model goes feature → Nick/preview/integration, not straight to `main` (Vercel
auto-deploys `main`).

## `next.config.ts`
- **CSP** (static, no nonce): locks `frame-ancestors`, `form-action`, `base-uri`,
  `object-src`; allows `'unsafe-inline'` for scripts/styles (App Router hydration +
  framer-motion); `'unsafe-eval'` dev-only.
- **Image `remotePatterns`**: `i.scdn.co`, `mosaic.scdn.co`, `*.mzstatic.com`.
- **`optimizePackageImports`**: `lucide-react`, `framer-motion`, `sonner`.
- **Security headers** everywhere: `X-Content-Type-Options: nosniff`,
  `X-Frame-Options: DENY`, strict `Referrer-Policy`, HSTS (prod).

## Middleware — `proxy.ts`
Wraps NextAuth `auth()`. Authenticated `/` → `/feed`; unauthenticated `/feed` → `/`, other
protected pages → `/sign-in?from=<path>` (401 for APIs). `/api/cron/*` and `/api/auth/*` are exempt. See
[[auth-and-session]].

## Cron — `vercel.json`
Two jobs, both daily and both gated by `Authorization: Bearer <CRON_SECRET>` (`withCronRoute`,
`lib/api/with-authed-route.ts`):
- `GET /api/cron/mb-backfill` at `0 4 * * *` (04:00 UTC): fills missing external ids on
  `artists` (`spotify_id`, `mbid`, `apple_id`, `deezer_id`) from MusicBrainz, up to 120 artists a run.
- `GET /api/cron/recommendations` at `0 3 * * *` (03:00 UTC): expires unseen recs >3 days,
  hard-deletes rows expired >30 days via `rpc_prune_recommendation_cache` (migration 0045),
  keeping `skip_at` permanent dismissals and seen rows whose artist the user liked, passed or
  saved (#219, so History keeps them). Until 0045 is applied the RPC call fails and the job
  logs `prune skipped` and deletes no Feed rows. It also deletes `login_attempts` rows older
  than 24 hours (which is also when a new-account bucket's 24h window ends, #218).

See [[api-routes]].

## Color extraction — `lib/colour-extraction.ts`
Server-only. Fetches artist image from an allowlisted CDN set (`i.scdn.co`,
`mosaic.scdn.co`, `is[1-5]-ssl.mzstatic.com`), 8s fetch timeout, 5MB cap, `node-vibrant`
(5s parse timeout). Enforces WCAG AA contrast vs black (lightens in HSL until ≥4.5:1 or
falls back to `#8b5cf6`). Runs in `after()` during generation; writes
`artists.artist_color` and copies it into the user's `recommendation_cache.artist_data`. Client-safe helpers in `lib/color-utils.ts`
(`sanitizeHex`, `stringToVibrantHex`, `hexToRgba`).

## Small but load-bearing
- `lib/types.ts` → `GenreNode` (shared with `data/genres.json` and [[genre-system]]).
- `lib/errors.ts` → `apiError`, `apiUnauthorized`, `apiNotFound`, `dbError`.
- `lib/spotify-ids.ts` → `isValidSpotifyId` (base62×22), used by the saves route (track id) and
  onboarding resolve; `isValidArtistId` (internal artist id) guards the feedback, dismiss,
  saves, open, artist-tracks and seed-artist routes.

## Environment variables (observed)
`USERNAME_HMAC_SECRET`, `USERNAME_ENCRYPTION_KEY`, `AUTH_SECRET`/`NEXTAUTH_SECRET`,
`SPOTIFY_CLIENT_ID`/`SPOTIFY_CLIENT_SECRET` (shared client-creds key),
`LASTFM_API_KEY`, `CRON_SECRET`, `SUPABASE_*` (URL, anon, service-role), and the
origin/URL vars used by CSRF ([[auth-and-session]]). The Spotify and iTunes/Apple keys are a
**single shared set** across local/preview/prod — throttling one throttles all; measure perf
by request-count, not wall-clock.

## Tests & build
`vitest` (`npm test`), `next build`, `eslint`. `npm run build` is `vitest run && next build`,
so a failing test blocks a Vercel deploy. Genre/cache scripts via `npx tsx` (see
[[genre-system]]).

The static design mockups moved from `public/mockups/` to `docs/archive/mockups/` on
2026-11-22 and are no longer served (there is no `public/` folder now).

- `npm run measure:bundle` (`scripts/measure-bundle.mjs`): after `npx next build`, prints each
  page route's first-load client JS (raw and gzip), the feed's `next/dynamic` layout chunks
  (from the route's `react-loadable-manifest.json`) and the 15 largest client chunks (their
  contents too if `npx next analyze --output` ran after the build).
- `npm run build:landing-sample` (`scripts/build-landing-sample.mjs`): regenerates
  `data/landing-sample.json`, the landing page's six sample artists (iTunes artwork and
  previews from the public iTunes Search API); run `npm test` after it, where
  `validateLandingSample` checks every URL is on the CSP's iTunes hosts.
