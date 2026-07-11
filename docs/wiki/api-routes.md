---
title: API Routes
updated: 2026-07-11
related: [[generation-engine]], [[explore-engine]], [[music-providers]], [[auth-and-session]], [[data-model]]
---

# API Routes

The HTTP surface under `app/api/`. Auth = NextAuth session cookie via `safeAuth()` (every route
now goes through `safeAuth`, not raw `auth()` — a corrupted session cookie is treated as
signed-out instead of a 500). Mutations enforce CSRF (`enforceSameOrigin`) either through the
wrappers in `lib/api/with-authed-route.ts` or inline. See [[auth-and-session]].

Mutating routes go through `withAuthedCsrfRoute`/`withAuthedJsonRoute` (CSRF → `safeAuth` →
optional JSON body-parse, in that order) as the house pattern. Exceptions that stayed on an
inline preamble because a wrapper would have changed observable behavior (check order or
error-message text):
- `/api/spotify/like`, `/api/spotify/resolve-track` — check the Spotify access token *before*
  parsing the body (a missing token 401s ahead of a body-parse failure); adopted
  `withAuthedCsrfRoute` for CSRF+auth but keep body-parsing local.
- `/api/onboarding/resolve` — rate-limits before parsing the body, and its invalid-body error
  is `"Invalid JSON body"`, not the wrapper's generic `"Invalid JSON"`.
- `/api/onboarding/seeds`, `/api/settings/seed-artists` (POST) — invalid-body error is
  `"Invalid JSON body"`, not `"Invalid JSON"`.
- `/api/history/accumulate` — a missing/invalid body falls through to the
  `"source must be 'lastfm' or 'statsfm'"` validation error, not a generic JSON-parse error.

All of the above still adopted `withAuthedCsrfRoute` for the shared CSRF+auth preamble; only
the body-parse step stayed local. GET-only routes (`/api/history`, `/api/onboarding/check`,
`/api/explore/rails`, etc.) stay on plain `safeAuth()` — no CSRF needed.

## Generation & discovery

| Route | Method | Does | Calls |
|---|---|---|---|
| `/api/recommendations` | GET | read ≤40 unseen/unexpired `recommendation_cache`, underground re-filter, return 20 | cache only |
| `/api/recommendations/generate` | POST | `buildRecommendations`; 30s cooldown; refuses if unseen ≥60 unless `?replace=true`; schedules `runSecondary`+color via `after()` | [[generation-engine]], Spotify, iTunes |
| `/api/explore/generate` | POST | `buildExploreRails`; `?force=true` → background regen, returns `{regenerating}` | [[explore-engine]] |
| `/api/explore/preload` | GET | background warm from Feed (`hydrate:true`) | [[explore-engine]] |
| `/api/explore/rails` | GET | read-only snapshot + `generatedAt` for poll-swap | [[explore-engine]] |
| `/api/artists/[id]/tracks` | GET | lazy tracks for a card; cache→iTunes; name/ID cross-check guards cache poisoning | **iTunes only** |

## Feedback, saves, history

| Route | Method | Does |
|---|---|---|
| `/api/feedback` | POST | `rpc_record_feedback`; thumbs → `invalidateExploreCache` (narrow for explore, full for feed) |
| `/api/feedback/[artistId]` | DELETE | `rpc_delete_feedback` (undo thumbs), 204 |
| `/api/dismiss/[artistId]` | DELETE | `rpc_clear_dismiss` + full explore invalidate, 204 |
| `/api/saves` | POST/DELETE | upsert/delete `saves`; optional save→Spotify playlist (degrades to `playlistError`) |
| `/api/history` | GET | paginated seen recs + feedback/saves join |
| `/api/history/accumulate` | POST | 15-min cooldown; sync Last.fm or stats.fm history into `listened_artists` |

## Onboarding & settings

| Route | Method | Does |
|---|---|---|
| `/api/onboarding/search` | GET | **Spotify search** (client-creds), 120/min per user; **falls back to `artist_search_cache` ILIKE on 429** (`degraded:true`) |
| `/api/onboarding/resolve` | POST | resolves a Last.fm-sourced onboarding suggestion to the internal artist uuid: `artists`-table exact-name doorway lookup first, MusicBrainz mbid url-rels fallback → mint; 404 when unresolvable; 30/min per-user in-memory rate limit |
| `/api/onboarding/seeds` | POST | upsert `seed_artists` (3–200) |
| `/api/onboarding/check` | GET | `{needsOnboarding}` |
| `/api/settings` | PATCH | validate + encrypt usernames + update `users`; genre/mode change → invalidate caches |
| `/api/settings/seed-artists` | GET/POST/DELETE | manage seeds + invalidate explore |
| `/api/account` | DELETE | delete user (cascade) + sign out |

## Spotify-specific & misc

| Route | Method | Notes |
|---|---|---|
| `/api/spotify/like` | POST | `musicProvider.likeTrack`; requires user token; 401/403 on auth issues |
| `/api/spotify/resolve-track` | POST | resolve track→Spotify ID for "like"; ID/name guard against cache poisoning |
| `/api/open/[platform]/[artistId]` | GET | **only `apple_music`** — resolves Apple Music URL via iTunes, caches 30d, 302 redirect |
| `/api/auth/[...nextauth]` | GET/POST | NextAuth handlers (incl. optional Spotify OAuth) |
| `/api/cron/recommendations` | GET | **no session** — `CRON_SECRET` Bearer (timing-safe); expire >3d unseen, hard-delete >30d (keeps `skip_at`) |

## The "Open in Spotify" path
Spotify links are **client-side, zero-API**: `lib/music-links.getArtistLink('spotify', …)`
returns `https://open.spotify.com/artist/{spotifyArtistId}` from the stored ID. Apple Music
goes through `/api/open/apple_music/[id]` (iTunes resolver + cache); YouTube Music is a
search URL. The `open/[platform]` route 400s on anything but `apple_music`. See
[[pages-and-components]] and [[spotify-dependency]].

## Known issues (verify before relying)
- ~~`history/route.ts` returns `seenArtistIds.length === limit` instead of the correctly-
  computed `hasMore`~~ **FIXED**: `hasMore` is now computed from a `limit + 1` overfetch in
  `lib/history/query.ts` (`getHistoryPage`), shared by `/api/history` and the `/history` page —
  exact at the boundary, no more spurious empty last page.
- `onboarding/search` and `onboarding/resolve` rate limiters are **per serverless instance**
  (not global) — both now go through the shared `createWindowLimiter` factory in
  `lib/rate-limiter.ts` (fixed-window, in-memory `Map` per instance). See that file's JSDoc for
  why this is deliberate and what the upgrade path is if it ever needs to be a hard cap.
- `history/accumulate` passes `""` as the Spotify token when client-creds is null → silent
  401s during a throttle.
- `after()` background work (secondary pool + color extraction) is bounded by the function's
  max duration.
