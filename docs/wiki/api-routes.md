---
title: API Routes
updated: 2026-11-22
related: [[generation-engine]], [[music-providers]], [[auth-and-session]], [[data-model]]
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
- `/api/onboarding/resolve` — rate-limits before parsing the body, and its invalid-body error
  is `"Invalid JSON body"`, not the wrapper's generic `"Invalid JSON"`.
- `/api/onboarding/seeds`, `/api/settings/seed-artists` (POST) — invalid-body error is
  `"Invalid JSON body"`, not `"Invalid JSON"`.
- `/api/history/accumulate` — a missing/invalid body falls through to the
  `"source must be 'lastfm' or 'statsfm'"` validation error, not a generic JSON-parse error.

All of the above still adopted `withAuthedCsrfRoute` for the shared CSRF+auth preamble; only
the body-parse step stayed local. GET routes use `withAuthedRoute` (no CSRF). The shell hands
handlers a lazily-created service-role client as `ctx.supabase` (tests mock
`@/lib/supabase/server`). `GET /api/onboarding/search`, `GET /api/history` and
`GET /api/recommendations` moved onto `withAuthedRoute` on 2026-11-22 (the search route no
longer logs `[onboard-search] unauth` before its 401). Crons use
`withCronRoute(tag, handler)` — the single `CRON_SECRET` check.

`lib/api/routes-wrapped.test.ts` reads every `app/api/**/route.ts` and fails if a
`POST`/`PATCH`/`PUT`/`DELETE` export is not written as
`export const X = withAuthedCsrfRoute(` / `withAuthedJsonRoute(` (imported from
`lib/api/with-authed-route`). The only allowlisted file is `auth/[...nextauth]/route.ts`.

## Generation & discovery

| Route | Method | Does | Calls |
|---|---|---|---|
| `/api/recommendations` | GET | read ≤40 unseen/unexpired `recommendation_cache`, underground re-filter, return 20 | cache only |
| `/api/recommendations/generate` | POST | `buildRecommendations`; refuses (429) if unexpired unseen ≥60 unless `?replace=true` (checked before the cooldown claim); 30s cooldown; with `?replace=true` the old unseen, non-dismissed rows are deleted after the build returns, and only if it wrote or re-queued something (see [[generation-engine]]); no `?genre` filter any more; schedules `finish()` (secondary + preview flush) + color via `after()` | [[generation-engine]], Spotify, iTunes |
| `/api/artists/[id]/tracks` | GET | lazy tracks for a card; cache→iTunes; name/ID cross-check guards cache poisoning | **iTunes only** |

## Feedback, saves, history

Which caches each taste change invalidates is decided in one place: `lib/taste-change.ts`
(`onTasteChanged` / `invalidationFor`). Today only a settings change to `selectedGenres`
wipes anything (the user's unseen Feed rows); `fameLevel`, thumbs, saves, undismiss and seed
changes reach the next batch through the engine's normal reads. A `skip` is not a taste change.
The `/api/explore/*` routes were removed with the Explore page (2026-11-10, #205).

| Route | Method | Does |
|---|---|---|
| `/api/feedback` | POST | thumbs-up first ensures this week's `user_challenges` row (`ensureCurrentChallenge`) so the RPC can credit it; `rpc_record_feedback_v2`. A `railKey` from an old Explore client is ignored |
| `/api/feedback/[artistId]` | DELETE | `rpc_delete_feedback_v2` (undo thumbs), 204 |
| `/api/dismiss/[artistId]` | DELETE | stamps the row's `created_at` = now and `expires_at` = now + 30 days (as the engine's re-queue does, so the returned card outlives the nightly cron; 500 and nothing changed if that fails), then `rpc_clear_dismiss_v2`, 204 |
| `/api/saves` | POST/DELETE | upsert/delete `saves`; POST first ensures this week's challenge row (`ensureCurrentChallenge`) and credits a `save_*` challenge via `rpc_increment_challenge_progress(p_signal 'save')` only when the save row didn't exist before; response keeps `playlistId: null` (the Spotify-playlist branch was removed in #175) |
| `/api/history` | GET | paginated seen recs + feedback/saves join |
| `/api/history/accumulate` | POST | 15-min cooldown, claimed before the sync; sync Last.fm or stats.fm history into `listened_artists`. A failed sync returns 500 and leaves a 1-minute wait (the stamp is set to 14 minutes ago, not restored to its old value). A failed `listened_artists` select or insert now fails the sync (500); a failed play-count bump is only logged |

## Onboarding & settings

| Route | Method | Does |
|---|---|---|
| `/api/onboarding/search` | GET | prefix match on the `artists` table (`name_lower` ILIKE, up to 10); with fewer than 5 hits, tops up from Last.fm `artist.search` (those carry an `lf:` id and `needsResolve: true`, resolved by `/api/onboarding/resolve` on selection). No Spotify call. Queries under 2 characters return an empty list; 120/min per user (in-memory), 429 over that |
| `/api/onboarding/resolve` | POST | resolves a Last.fm-sourced onboarding suggestion to the internal artist uuid: `artists`-table exact-name doorway lookup first, MusicBrainz mbid url-rels fallback → mint under MB's canonical name (client name must match it at ≥0.8 similarity after folding diacritics, else 404; the check is skipped when exactly one name has Latin letters, e.g. "BTS" vs "방탄소년단"); 404 when unresolvable; 30/min per-user in-memory rate limit |
| `/api/onboarding/seeds` | POST | upsert `seed_artists` (3–200 per request; existing + new ≤ 200 total, same check as settings; a repeated id counts once, and the 3 minimum is counted after that) |
| `/api/settings` | PATCH | validate + encrypt usernames + update `users` (401 if no row was updated: deleted account); a changed Last.fm / stats.fm username clears that source's sync cooldown; `selectedGenres` is stored without empty strings or duplicates (a NUL character → 400) and a change → unseen-feed wipe; `fameLevel` → nothing (next batch only); `adventurous` → 400 (`"adventurous is no longer a setting"`, retired) |
| `/api/settings/seed-artists` | GET/POST/DELETE | manage seeds |
| `/api/account` | DELETE | delete user (cascade) + sign out; answers 200 `{ success: true }` with the cleared session cookie, no redirect (the client navigates) |

## Misc

| Route | Method | Notes |
|---|---|---|
| `/api/open/[platform]/[artistId]` | GET | **only `apple_music`** — `linkFor` (`lib/external-links.ts`): cached iTunes result (30d) → live iTunes by the `artists` row name (never client `?name`; `itunesFetch` gate-only: no preview breaker, no counter) → search URL; 302 redirect; 404 unknown artist id. `artists.apple_id` is NOT trusted (MB name search, homonym risk) |
| `/api/auth/[...nextauth]` | GET/POST | NextAuth handlers (Credentials only) |
| `/api/cron/recommendations` | GET | **no session** — `CRON_SECRET` Bearer (timing-safe); expire >3d unseen not-yet-expired rows, hard-delete >30d expired (keeps `skip_at`), delete `login_attempts` rows older than 24 hours (a failure there is logged, the job still succeeds) |

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
- `onboarding/search` (120/min), `onboarding/resolve` (30/min), `artists/[id]/tracks` (120/min) and `open/...` (30/min) per-user rate limiters are **per serverless instance**
  (not global) — both now go through the shared `createWindowLimiter` factory in
  `lib/rate-limiter.ts` (fixed-window, in-memory `Map` per instance). See that file's JSDoc for
  why this is deliberate and what the upgrade path is if it ever needs to be a hard cap.
- `history/accumulate` passes `""` as the Spotify token when client-creds is null → silent
  401s during a throttle.
- `after()` background work (secondary pool + color extraction) is bounded by the function's
  max duration.
