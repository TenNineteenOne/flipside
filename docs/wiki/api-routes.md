---
title: API Routes
updated: 2026-06-06
related: [[generation-engine]], [[explore-engine]], [[music-providers]], [[auth-and-session]], [[data-model]]
---

# API Routes

The HTTP surface under `app/api/`. Auth = NextAuth session cookie via `safeAuth()`/`auth()`;
mutations enforce CSRF (`enforceSameOrigin`) either through the wrappers in
`lib/api/with-authed-route.ts` or inline. See [[auth-and-session]].

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
- `history/route.ts` returns `seenArtistIds.length === limit` instead of the correctly-
  computed `hasMore` — last-page `hasMore` can be wrong.
- `onboarding/search` rate limiter is **per serverless instance** (not global).
- `history/accumulate` passes `""` as the Spotify token when client-creds is null → silent
  401s during a throttle.
- `after()` background work (secondary pool + color extraction) is bounded by the function's
  max duration.
