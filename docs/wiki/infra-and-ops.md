---
title: Infra & Ops
updated: 2026-06-06
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
Wraps NextAuth `auth()`. Authenticated `/` → `/feed`; unauthenticated protected pages →
`/?from=…` (401 for APIs). `/api/cron/*` and `/api/auth/*` are exempt. See
[[auth-and-session]].

## Cron — `vercel.json`
One job: `GET /api/cron/recommendations` at `0 3 * * *` (03:00 UTC). Verifies
`Authorization: Bearer <CRON_SECRET>` (timing-safe HMAC), then expires unseen recs >3 days
and hard-deletes rows expired >30 days (excluding `skip_at` permanent dismissals). See
[[api-routes]].

## Color extraction — `lib/colour-extraction.ts`
Server-only. Fetches artist image from an allowlisted CDN set (`i.scdn.co`,
`mosaic.scdn.co`, `is[1-5]-ssl.mzstatic.com`), 8s fetch timeout, 5MB cap, `node-vibrant`
(5s parse timeout). Enforces WCAG AA contrast vs black (lightens in HSL until ≥4.5:1 or
falls back to `#8b5cf6`). Runs in `after()` during generation; writes
`artist_search_cache.artist_color`. Client-safe helpers in `lib/color-utils.ts`
(`sanitizeHex`, `stringToVibrantHex`, `hexToRgba`).

## Small but load-bearing
- `lib/utils.ts` → `cn()` (clsx + tailwind-merge).
- `lib/types.ts` → `GenreNode` (shared with `data/genres.json` and [[genre-system]]).
- `lib/errors.ts` → `apiError`, `apiUnauthorized`, `apiNotFound`, `dbError`.
- `lib/spotify-ids.ts` → `isValidSpotifyId` (base62×22) — path-traversal defense on
  save/like/resolve/open routes.

## Environment variables (observed)
`USERNAME_HMAC_SECRET`, `USERNAME_ENCRYPTION_KEY`, `AUTH_SECRET`/`NEXTAUTH_SECRET`,
`SPOTIFY_CLIENT_ID`/`SPOTIFY_CLIENT_SECRET` (shared client-creds key),
`LASTFM_API_KEY`, `CRON_SECRET`, `SUPABASE_*` (URL, anon, service-role), and the
origin/URL vars used by CSRF ([[auth-and-session]]). The Spotify and iTunes/Apple keys are a
**single shared set** across local/preview/prod — throttling one throttles all; measure perf
by request-count, not wall-clock.

## Tests & build
`vitest` (`npm test`), `next build`, `eslint`. Genre/cache scripts via `npx tsx` (see
[[genre-system]]).
