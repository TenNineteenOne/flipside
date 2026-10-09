# Flipside — Design Spec & Port Handoff

**Audience:** the AI agent (Claude / Cursor / Codex) maintaining the work-hosted variant of
Flipside on Sage.
**Purpose:** this document is the authority on how Flipside is *supposed to operate*. Use it
to (1) verify the Sage port still behaves correctly, (2) fix anything that has drifted, and
(3) make future changes without breaking the design.
**Baseline:** the personal repo (`github.com/TenNineteenOne/flipside`) at `main` commit
`4869536` ("Merge pull request #172"). A read-only manifest comparison on 2026-08-01 found
the Sage tree recognizably the same project: 327 byte-identical files, 69 changed (mostly
legitimate post-import work), 17 original-only (Vercel/NextAuth material), 22 Sage-only
(Dockerfile, Postgres shim, platform auth, Slack/onboarding additions, cron runners).

**How to use this doc.** Every behavior in the app falls into one of three buckets:

| Bucket | Meaning | Your job |
|---|---|---|
| **MUST MATCH** | Product/domain behavior — the engines, scoring, caching, data semantics. | If the Sage code diverges, fix the Sage code to match this spec. |
| **MUST DIFFER** | The four platform seams (auth, database, hosting, cron). The personal version uses NextAuth/Supabase/Vercel; the Sage version must use the platform equivalents described in §6. | Verify the seam contract holds; never "fix" these back to the personal implementation. |
| **MAY DIFFER** | Post-import product work done at work (e.g. Slack additions, onboarding tweaks). | Keep it, unless it violates a MUST-MATCH invariant — then reconcile. |

Do not chase byte-parity with the personal repo. Chase **invariant-parity** with this spec.

---

## 1. What Flipside is

A music-discovery web app. Users log in (in the personal version: username only; on Sage:
the platform identity — see §6.1), tell it a few artists/genres they like, and get two
personalized discovery surfaces:

- **Feed** ("For You") — a scored, diversity-capped stack of artist cards, each with 1–3
  playable 30-second preview tracks.
- **Explore** — four themed rails: *After Hours* (mood tags), *Uncharted Territory*
  (untouched genres), *Rabbit Holes* (deep similar-artist chains), *Curveballs*
  (far-out genre picks).

Users react (thumbs up/down, skip, save), and reactions steer future generations.
Listening history can be imported from **Last.fm** and **stats.fm** (and optionally
Spotify, where the OAuth connect exists).

**The critical mental model — do not infer from training priors:**

- **Spotify is NOT the login** and NOT the recommendation engine.
- **Last.fm is the recommendation brain** (similar artists, genre tags, enrichment).
- **iTunes is the primary preview-audio source** (keyless).
- **MusicBrainz** (keyless) recovers external platform IDs.
- The Spotify Web API is a *peripheral*: preview fallback + optional user-connect
  extras. As of Feb 2026, Spotify removed popularity/followers, deprecated genres,
  nulled `preview_url` for client-credentials apps, and removed top-tracks /
  related-artists / recommendations for non-extended-quota apps. The app was
  re-architected (Stage 2, see §3) so generation runs **Spotify-free**.

## 2. Tech shape

Next.js 16 App Router, React 19, TypeScript, Tailwind v4. Two route groups:

| Group | Routes | Auth |
|---|---|---|
| `app/(app)` | `/feed`, `/explore`, `/history`, `/saved`, `/stats`, `/settings` | required |
| `app/(marketing)` | `/sign-in`, `/onboarding` | public (personal); on Sage the platform gate covers everything |
| `app/api` | HTTP surface (§5.7) | mixed |

Every `(app)` page is an async **server component** that queries the database directly,
then hands serialized data to a `"use client"` shell. A single `HTMLAudioElement` lives in
`AudioProvider` so preview playback survives navigation (floating `MiniPlayer`).

Persistence is Postgres. In the personal version it's Supabase (RLS + anon/service-role
clients); on Sage it's a `DATABASE_URL` Postgres behind a server-side shim (§6.2). All
schema history is in `supabase/migrations/0001–0041`; the Sage database must be
structurally equivalent to the result of replaying all of them (§6.2).

## 3. Artist identity — the Stage-2 model (MUST MATCH)

This is the most load-bearing design decision in the codebase. Older docs (including some
`docs/wiki/` pages in-tree) predate it; **this section wins over anything that
contradicts it.**

- The canonical identity of an artist is an **internal surrogate UUID**: `artists.id`
  (table created in migration 0036). `Artist.id` in TypeScript
  (`lib/music-provider/types.ts`) is this UUID.
- `spotify_id` is an **attribute, not the identity** — nullable, unique when present,
  used only to build Spotify links and call Spotify endpoints. Migration 0039 dropped
  every legacy `spotify_artist_id` column from the per-user tables; per-user tables key
  on `artist_id uuid` referencing `artists`.
- `artists` doubles as the **name-resolution cache** (the old `artist_search_cache`
  table is dead). `lib/recommendation/artist-name-cache.ts` is the single "doorway"
  lookup (`batchRead`, chunked at 500): `name_lower` is **non-unique** (homonyms
  coexist), and an ambiguous name (>1 row) deliberately reads as a **cache miss**.
- **Write policy (fill-only, hardened in #161):** minting goes through one shared policy
  (`ensureArtist`/`ensureArtists` + the cache `write`): mint a UUID, then fill-only
  metadata UPDATE keyed on that UUID — never a second insert (a bare insert once
  duplicated a just-minted row and made the name permanently ambiguous). `name` /
  `name_lower` are never overwritten; empty genres, zero popularity, or a null image
  never clobber richer values. Dedup on `spotify_id` when the artist carries one, else
  get-or-create by name. Migration 0041 restores a partial unique index protecting
  unresolved names.
- **External-ID recovery is lazy and keyless:** the daily MusicBrainz backfill worker
  (`app/api/cron/mb-backfill/route.ts`, #159) resolves `spotify_id` / `mbid` /
  `apple_id` / `deezer_id` via MusicBrainz **url-rels** (`lib/music-provider/
  musicbrainz.ts`) — never the Spotify API. MusicBrainz is limited to **1 req/s,
  single process**, and requires a descriptive `User-Agent` (the constant currently
  embeds a personal contact address — on the work version, point it at a work
  contact; see §6.4).
- Consequence: an artist resolved from Last.fm may have `spotifyId: null` for up to a
  day. Everything downstream must tolerate that: the Spotify preview fallback no-ops on
  a null `spotifyId` (never call Spotify with the internal UUID — it would 404 and trip
  the breaker), and "Open in Spotify" needs the backfilled ID (or is absent until then).

## 4. The generation flow (MUST MATCH)

Both surfaces share one resolver/confirm core:

```
seeds → Last.fm similarity / tag fan-out → candidate names
      → resolve names → artists (doorway cache → Last.fm artist.getInfo, mint uuid)
      → filter (listened / thumbs-down / cooldown / underground cap)
      → score (k^popularity) + diversity (greedy + 25% cluster cap)
      → confirm playable preview (iTunes first → Spotify top-tracks fallback)
      → write to cache (recommendation_cache / explore_cache)
```

### 4.1 Feed pipeline — `buildRecommendations` in `lib/recommendation/engine.ts`

In order (numbers are part of the spec):

1. **Gather seeds** (`gatherSeedContext`) — three parallel sources: `seed_artists`
   (onboarding picks), a weekly-stable sample of thumbs-up artists (`sampleLikes`), and
   Last.fm `tag.gettopartists` for the user's top ~5 `selected_genres`. Shuffled +
   deduped, capped at 10–15 seed names.
2. **Soften gate** (`runWithSoftening`) — a run returning `count=0` retries with
   `playThreshold+5`, then falls back to `sampleColdStartSeeds()` from
   `data/cold-start-seeds.json`.
3. **First-hop similarity** — each seed → `musicProvider.getSimilarArtistNames` →
   **Last.fm `artist.getSimilar`** (7-day cached). Optional second hop (`runDeepHop`)
   when the user's `deep_discovery` setting is on.
4. **Round-robin ordering** (`buildRoundRobinNames`, `tailFirst=true`) — interleave
   candidates across seeds, lowest-match-first, so no mainstream seed floods the
   blocking slots.
5. **Pool split** (`resolve-pools.ts`) — first **36** names form the blocking pool, next
   **54** the secondary pool (resolved after the response). These caps are the primary
   latency knob.
6. **Resolve** (`resolveArtistsByName`, `resolve-candidates.ts`) — doorway-cache-first;
   misses go to the provider-agnostic `searchArtists` dependency, which is wired to
   **Last.fm `artist.getInfo`** (Spotify-free since #157), with enrichment merged in.
   Minting (`mintArtist` → `ensureArtist`) assigns the canonical UUID; if minting fails
   the resolver **skips caching** that name rather than persist a non-UUID identity.
   Backoff budget: 90 s total / 20 s per name, ≤3 attempts, 4 workers, 200 ms spacing.
   Fuzzy matches accepted at Dice similarity ≥ 0.8. A rate-limit sentinel is honored
   (skip retry immediately).
7. **Filter** — drop thumbs-down artists, artists listened more than `play_threshold`
   times, popularity > 50 under underground mode, and non-matching genre when a genre
   filter is active.
8. **Score** — `score = k^popularity × 0.8 + seedRelevance × 0.2 − adventurousPenalty`,
   where `k` = user's `popularity_curve` (0.90–1.00, default 0.95). Lower `k` punishes
   popularity harder. Genres + popularity come from Last.fm enrichment
   (`enrich-artist.ts`, listeners → `scaleListeners`); Spotify cannot supply them.
9. **Greedy diversity** (`greedyPickTop`) — from the top 40, pick 20 with soft
   per-genre (10%) and per-seed (8%) penalties.
10. **Hard cluster cap** (`applyClusterCap`, `cluster-cap.ts`) — no genre may exceed
    **25%** of the 20-item feed.
11. **Adjacent-genre bleed** (`augmentWithAdjacent`) — inject 4–10 picks from
    close/medium adjacent genre tags at positions 5–7+ (skipped when a genre filter is
    active).
12. **Confirm previews, Tier 1** (`confirmToTarget`, `confirm-previews.ts`) — first
    **8** artists, in waves: tracks cache → **iTunes `search?entity=song`** → Spotify
    `/artists/{id}/top-tracks` fallback (only when `spotifyId` is non-null). Artists
    with no playable preview are **dropped, never shown**.
13. **Write Tier 1** (`writeScored`) — upsert ≤8 rows to `recommendation_cache`;
    confirmed `topTracks` are baked into the cached card and written back to the artist
    row (warm reuse).
14. **Return fast** — the HTTP response's `count` reflects **only Tier 1**. The result
    carries a `runSecondary` closure plus metrics.
15. **Background** — the route schedules `runSecondary` via Next's `after()`: confirm
    the rest of the blocking pool (Tier 2, ≤12), then the secondary pool (≤20), writing
    each batch. Color extraction also runs here (§5.9).

`FIRST_BATCH_TARGET = 8` is hardcoded by design. The client feels this as **fast first
paint, fill in background** — the feed page renders as soon as ~8 cards exist and
`useFeedFill` polls `GET /api/recommendations` every 2.5 s to append (stops at target /
3 idle polls / 60 s).

### 4.2 Preview confirmation — the tri-state contract

`Artist.topTracks` semantics (in `lib/music-provider/types.ts`) are load-bearing across
engine, cache rows, and UI guards:

| Value | Meaning | Behavior |
|---|---|---|
| `undefined` | never confirmed | confirm step must resolve it; legacy cached rows pass the read-path playability guard |
| `[]` | **negative cache**: confirmed no preview exists | drop the artist; skip the network |
| `[…]` | confirmed playable | ship with the card |

`itunes.ts:searchTracksByArtist` returns `null` on failure/breaker-open vs `[]` on a
genuine zero-match — callers must distinguish (only `[]` may become a negative cache).
The read paths (`hasPlayablePreview`) are a last line of defense: never render a card
without at least one track with a non-empty `previewUrl`.

### 4.3 Explore pipeline — `buildExploreRails` in `lib/recommendation/explore-engine.ts`

- Four rails built under `Promise.allSettled` (one failure never blocks the others):

| Rail key | UI title | Candidate source |
|---|---|---|
| `adjacentRail` | After Hours | stable 6-tag rotation from `AFTERHOURS_TAGS` via `cacheWindowSeed`; `tag.gettopartists` per tag |
| `outsideRail` | Uncharted Territory | genre anchors the user *hasn't* touched; Last.fm top-40 per anchor, sliced positions 10–40 |
| `wildcardsRail` | Rabbit Holes | 3–4 thumbs-up seeds → similar artists, tail-biased; falls back to most-played; empty when cold |
| `leftfieldRail` | Curveballs | all genre-tree leaves excluding the user's top-2 anchors; seeded-shuffle, sample 34–60 tags, mid-list picks |

- `leftfieldRail` resolves the first 48–80 names on the critical path and fires a
  non-blocking warm-resolve of the next ~40 (only on the primary `seedKey='leftfield'`
  pass). With zero thumbs-ups, wildcards is replaced by a second leftfield run
  (`seedKey='wildcards-fallback'`).
- Post-processing, in order: cross-rail 25% cluster cap (swaps stay within a rail),
  cross-rail dedup (first rail wins), minimum-floor topup (rails below 5 artists topped
  up via extra leftfield runs), cache write, then a belt-and-braces underground cap
  (drop popularity > 50 when underground mode is on).
- **Cache behavior:** one `explore_cache` row per `(user_id, rail_key)`, 24 h TTL.
  `regenerate:false` returns partial cache **without** building (the read path used by
  the page and `GET /api/explore/rails`); `force=true` rebuilds in the background and
  the client poll-swaps when `generatedAt` advances.
- **Weekly stability:** picks are stable inside a 7-day window
  (`cacheWindowSeed` = FNV-1a of `userId:seedKey:weekNumber`) and rotate at the weekly
  boundary, not on TTL expiry. Feed and Explore share the same like-sample so they feel
  coherent.
- `explore-rail-payloads.ts` is the single source of truth for rail titles/subtitles/
  empty captions and wildcards-fallback detection. Rows with `topTracks=[]` (negative
  cache) are dropped at payload assembly; `undefined` passes.
- Known behavioral gap (intentional, don't "fix" silently): Explore artists only enter
  `recommendation_cache` (and its 7-day cooldown) once the user acts on them.

## 5. Subsystem contracts

### 5.1 Providers & resilience (`lib/music-provider/`) — MUST MATCH

- `musicProvider` is a process-global singleton `SpotifyProvider` implementing the
  `MusicProvider` interface. The name is historical: `getSimilarArtistNames` makes
  **only Last.fm calls**. There is no runtime provider switching; swapping means a new
  class behind the same interface.
- `Track.source` is `'itunes' | 'spotify' | 'deezer'` — `deezer` is a forward-declared
  slot with zero implementation.
- **Circuit breakers / limiters** (parameters are spec):

| Mechanism | Behavior |
|---|---|
| `spotifyBreaker` (`preview-source-breaker.ts`) | opens after 5 failures, 60 s cooldown; honors `Retry-After` via `openUntil()` (can be ~24 h on a credential ban); `openUntil` always takes the **max** of current and new expiry. When open, callers receive a rate-limited sentinel with `skipRetry`. |
| `itunesBreaker` | 5 failures / 60 s; trips on 403/429/timeout; returns `null` so confirm falls back to Spotify. |
| `runItunes` (`itunes-limit.ts`) | max 5 concurrent, 50 ms min spacing. |
| `runLastfm` (`lastfm-limit.ts`) | max 12 concurrent. |
| `lastfm-cache.ts` | DB read-through cache (`lastfm_cache` table): 7-day positive TTL, 12 h negative; in-process in-flight dedup. |
| MusicBrainz limiter | strict 1 req/s, single-process (see §3). |
| onboarding limiters | in-memory fixed-window per instance: search 120/min/user, resolve 30/min/user (`createWindowLimiter` in `lib/rate-limiter.ts` — deliberately per-instance; see its JSDoc). |

- **Spotify tokens, two distinct credentials:** the optional per-user OAuth token
  (personal version only, encrypted in the session JWT) and the shared
  client-credentials token (`SPOTIFY_CLIENT_ID/SECRET` → `spotify-client-token.ts`,
  in-memory cache + in-flight dedup). Generation uses `userAccessToken ?? clientToken`
  for the *preview fallback only*. The client-credentials key is shared across every
  environment — throttling one throttles all; measure performance by request count, not
  wall-clock.

### 5.2 External APIs — MUST MATCH (endpoints + failure modes)

| Service | Auth | Used for | Failure mode |
|---|---|---|---|
| **Last.fm** | `LASTFM_API_KEY` (read-only) | `artist.getSimilar` (discovery graph), `tag.gettopartists` (rails/seeds), `artist.getInfo` (resolve + genres + listeners→popularity), `user.getTopArtists`/`getRecentTracks` (history) | concurrency-gated + DB-cached; hyphenated tags may return 0 → retried with spaces (second sequential call). Artist images from Last.fm are dead (placeholder) — never use them. |
| **iTunes** | none (keyless) | `search?entity=song` = primary 30 s previews; `search?entity=musicArtist` = Apple Music links | ~20 req/min soft limit, erratic per-IP 403s, no `Retry-After` → breaker + limiter are mandatory. Egress IP differs per host, so throttle behavior differs between local/personal-prod/Sage. |
| **Spotify Web API** | client-creds (shared) or user OAuth | `/artists/{id}/top-tracks` preview fallback; user-connect extras (history, like-track, save→playlist) where OAuth exists | Feb-2026 gutting (§1). Top-tracks may be dead for client-creds — the app must degrade to iTunes-only silently. |
| **MusicBrainz** | none; descriptive User-Agent required | url-rels → recover `spotify_id`/`apple_id`/`deezer_id`; onboarding resolve fallback | 1 req/s hard etiquette; match relations by URL host, not `type`. |
| **stats.fm** | none (public per-username) | `top/artists?range=lifetime` history import; items often embed `spotifyIds[]` | 8 s timeout, no breaker. |

### 5.3 Data model — MUST MATCH (structure), MUST DIFFER (engine — §6.2)

Per-user tables (all keyed by `user_id` + `artist_id uuid → artists.id`):

- `users` — identity + the whole settings block: `play_threshold` (int 0–50, default 0),
  `popularity_curve` (0.90–1.00, default 0.95), `underground_mode`, `deep_discovery`,
  `adventurous` (bools), `preferred_music_platform`
  (`spotify`|`apple_music`|`youtube_music`), `selected_genres text[]`, history-source
  usernames, cooldown timestamps (`last_generated_at`, `last_accumulated_*_at`,
  `onboarding_completed_at`). Note: `underground_mode` and `deep_discovery` are
  **both** live settings — neither supersedes the other.
- `listened_artists` — accumulated history from all sources
  (`spotify_recent`|`spotify_top`|`lastfm`|`statsfm`), `play_count`, `last_seen_at`;
  rows may hold only `lastfm_artist_name` with `artist_id` null until resolved
  (partial unique index protects unresolved names — 0041).
- `recommendation_cache` — the Feed queue: `artist_data jsonb` (the baked card incl.
  `topTracks`), `score`, `why jsonb`, `seen_at` (7-day cooldown), `skip_at` (30-day /
  permanent dismiss), `expires_at` (hard TTL), `source`. Hot query uses a partial index
  `WHERE seen_at IS NULL`.
- `explore_cache` — one row per `(user_id, rail_key)`, 24 h TTL.
- `feedback` — `(user_id, artist_id)` unique, `signal` in
  `thumbs_up`|`thumbs_down`, soft-delete via `deleted_at`.
- `saves`, `seed_artists`, `user_challenges` (weekly quests), `login_attempts`
  (personal-version login rate limiting).
- Shared caches: `artists` (identity + name cache + metadata, §3),
  `artist_tracks_cache` (track lists, 24 h app-enforced TTL via `fetched_at`, keyed by
  artist), `lastfm_cache` (`(kind,key)`), `artist_external_links` (Apple Music URLs,
  30-day).

**Database functions (RPCs) — semantics are spec** (defined in migrations 0036/0035;
server-only, EXECUTE revoked from public/anon/authenticated because they trust
`p_user_id`):

- `rpc_record_feedback_v2(user, artist, signal)` — validates signal
  (`thumbs_up`/`thumbs_down`/`skip`); upserts `feedback` (undeleting) for non-skip;
  marks `recommendation_cache.seen_at = now()` and sets `skip_at` on skip; on a
  *transition into* thumbs_up, increments the weekly challenge
  (`rpc_increment_challenge_progress`, UTC week start).
- `rpc_delete_feedback_v2(user, artist)` — soft-deletes feedback; deliberately does
  **not** clear `seen_at`.
- `rpc_clear_dismiss_v2(user, artist)` — clears both `skip_at` and `seen_at`
  (artist becomes re-eligible).
- `rpc_register_login_attempt` — atomic IP-hash login rate limit (personal version
  only; 10 attempts / 60 s).

### 5.4 Settings & the invalidation matrix — MUST MATCH

`PATCH /api/settings` (`lib/settings/patch-settings.ts`) validates and updates the
`users` row. Any discovery-affecting change triggers `lib/settings/regenerate.ts`, which
fires **both** `POST /api/recommendations/generate?replace=true` and
`POST /api/explore/generate?force=true` in parallel; both return after *scheduling* —
the UI copy is honest about async ("loading", poll-swap).

| Event | Invalidates |
|---|---|
| thumbs up/down | explore cache (narrow for an explore-originated artist, full for feed) |
| dismiss-undo (`/api/dismiss` DELETE) | full explore invalidate |
| seed or genre change, adventurous toggle | explore cache |
| settings change (any discovery knob) | regenerate both surfaces |
| 24 h TTL | explore rails rebuild on next forced generate |
| 7 days after `seen_at` | feed row eligible again |
| `skip_at` | 30-day / permanent exclusion (cron keeps them) |

### 5.5 Genre system — MUST MATCH

- `data/genres.json`: 4-level tree — 12 **Anchors** → ~80 **Clusters** →
  **Subclusters** (navigation-only, no `lastfmTag`) → ~6,291 **Leaves** with
  `lastfmTag`, everynoise 2-D coords, color, exemplar.
- `lib/genre/normalize.ts`: `normalizeGenre` lowercases and collapses
  hyphens/underscores/spaces — reconciles Spotify `"Indie Rock"`, Last.fm
  `"indie-rock"`, and stored tags. Raw values are never mutated.
- `lib/genre/adjacency.ts`: builds five in-memory indexes at module load;
  `adjacentGenres(tag, 'close'|'medium')` is k-NN (`close` = 15 nearest same-anchor,
  `medium` = 25 nearest other-anchor; coord-less tags fall back to cluster/anchor
  siblings). `allLeavesWithAnchor` feeds the leftfield rail; `primaryGenreOf` feeds the
  cluster cap.
- Maintenance scripts (`scripts/build-genres-v2.ts`, `build-subclusters.ts`,
  `validate-genre-tree.ts`, `backfill-artist-genres.ts`, …) are offline tooling; long
  scripts checkpoint to `.checkpoint.json`.

### 5.6 History accumulation — MUST MATCH

`POST /api/history/accumulate` (15-min per-source cooldown) syncs Last.fm or stats.fm
into `listened_artists`. Name→identity resolution goes through the same doorway lookup
(`artist-name-cache.batchRead` via `lib/history/id-resolver.ts`); unresolved names are
stored name-only and picked up later. stats.fm items often carry Spotify IDs directly.

### 5.7 HTTP surface — MUST MATCH (shape + guards)

House pattern: mutating routes go through `withAuthedCsrfRoute` / `withAuthedJsonRoute`
(`lib/api/with-authed-route.ts`): CSRF (`enforceSameOrigin`) → auth → optional JSON
parse, in that order. GET-only routes use plain session auth. A handful of routes keep
local body-parsing to preserve observable behavior (token-before-body on
`/api/spotify/*`, `"Invalid JSON body"` message on onboarding/seed routes,
source-validation error on `history/accumulate`).

| Route | Method | Contract |
|---|---|---|
| `/api/recommendations` | GET | read ≤40 unseen/unexpired cache rows, re-apply the underground filter, return 20; cache-only, no generation |
| `/api/recommendations/generate` | POST | runs the Feed pipeline; 30 s cooldown; refuses when unseen ≥60 unless `?replace=true`; schedules background tiers + color via `after()` |
| `/api/explore/generate` | POST | `?force=true` → background rebuild, returns `{regenerating}` |
| `/api/explore/rails` | GET | read-only snapshot + `generatedAt` (poll-swap) |
| `/api/explore/preload` | GET | background warm from the Feed |
| `/api/artists/[id]/tracks` | GET | lazy per-card tracks: cache → iTunes only; name/ID cross-check guards cache poisoning |
| `/api/feedback` (+`/[artistId]` DELETE) | POST/DELETE | `rpc_record_feedback_v2` / `rpc_delete_feedback_v2`; explore invalidation per §5.4 |
| `/api/dismiss/[artistId]` | DELETE | `rpc_clear_dismiss_v2` + full explore invalidate |
| `/api/saves` | POST/DELETE | upsert/delete; optional save→Spotify playlist degrades to `playlistError` (save still succeeds) |
| `/api/history` | GET | paginated seen recs + feedback/saves join; `hasMore` computed via limit+1 overfetch in `lib/history/query.ts` |
| `/api/history/accumulate` | POST | §5.6 |
| `/api/onboarding/search` | GET | typeahead: `artists` cache ILIKE first (≥5 hits skips network), else **Last.fm search**; cache hits carry the canonical uuid, Last.fm-only suggestions carry a synthetic `lf:` id + `needsResolve:true` |
| `/api/onboarding/resolve` | POST | resolves a suggestion to the canonical uuid: exact-name doorway lookup → MusicBrainz url-rels → mint; 404 when unresolvable |
| `/api/onboarding/seeds` | POST | upsert `seed_artists` (3–200) |
| `/api/settings` (+`/seed-artists`) | PATCH etc. | §5.4 |
| `/api/account` | DELETE | delete user row (cascades) + sign out |
| `/api/open/apple_music/[artistId]` | GET | resolve Apple Music URL via iTunes, cache 30 d, 302; 400 for any other platform |
| `/api/spotify/like`, `/api/spotify/resolve-track` | POST | user-OAuth-only extras; 401/403 without a token; ID validity + name guards |
| `/api/cron/recommendations` | GET | **no session** — bearer `CRON_SECRET` (timing-safe compare); expires unseen rows >3 d, hard-deletes rows expired >30 d (keeps `skip_at` dismissals) |
| `/api/cron/mb-backfill` | GET | same auth pattern; bounded single-process MusicBrainz backfill batch (§3) |

"Open in platform": Spotify = `https://open.spotify.com/artist/{spotify_id}` built
client-side, zero API. Apple Music = the `/api/open` resolver. YouTube Music = a search
URL. `lib/spotify-ids.ts` validates IDs (base62×22) as path-traversal defense on
save/like/resolve/open routes.

### 5.8 Client data flow — MUST MATCH (behavioral)

- `/feed`: server component reads unseen scored cache (≤20) + baked tracks; empty state
  mounts `RecommendationsLoader` + `ExplorePrewarm`. `FeedClient` interleaves, drops
  no-preview cards, polls to append (`useFeedFill`), and auto-generates when the queue
  runs low.
- `/explore`: never blocks on build (`regenerate:false` read); `ExploreClient`
  poll-swaps after shuffle/settings changes.
- Hooks contract: `useArtistFeedback` and `useArtistSaves` are optimistic with rollback
  and a per-artist serializer; `skip` is local-only (no server write from the hook);
  `useAdventurousMode` syncs `localStorage` across tabs and PATCHes settings.
- `ArtistCard` is the shared card everywhere (Feed and Explore rows adapt into it);
  a single `AudioProvider` context owns playback.

### 5.9 Color extraction — MUST MATCH

Server-only (`lib/colour-extraction.ts`), runs in the post-response phase of
generation: fetch artist image from an allowlisted CDN set (`i.scdn.co`,
`mosaic.scdn.co`, `is[1-5]-ssl.mzstatic.com`), 8 s fetch timeout, 5 MB cap,
node-vibrant with 5 s parse timeout, lighten in HSL until WCAG AA (≥4.5:1 vs black) or
fall back to `#8b5cf6`; write `artists.artist_color`. The color is **lazy-null** —
UI must fall back (deterministic name-hash color) when absent.

## 6. The Sage adaptation map (MUST DIFFER — verify the seam, don't revert it)

Four architectural seams changed in the port. For each: the personal implementation, the
required Sage shape, and what to verify.

### 6.1 Identity & auth

- **Personal:** NextAuth v5 credentials provider, username-only. Username is HMAC-ed
  (`USERNAME_HMAC_SECRET`) into `users.username_hash`; plaintext never stored. JWT
  session cookie holds only the user UUID. Login rate-limited per IP via
  `rpc_register_login_attempt`. History-source usernames encrypted at rest
  (AES-256-GCM, `USERNAME_ENCRYPTION_KEY`). Middleware (`proxy.ts`) gates every page
  and API except `/api/auth/*` and `/api/cron/*`.
- **Sage:** the platform's Cognito/Google gate authenticates; the app reads the work
  identity **server-side only** from the `x-impiricus-user-email` header, looks
  up/creates the internal `users` row, and has **no app-local session, no sign-in
  screen, no second auth system**. Sign-in UI, NextAuth routes, HMAC/encryption
  material, and login rate limiting are legitimately absent from the Sage tree.
- **Invariants that survive the seam:** identity resolution happens in exactly one
  server-side adapter (never trust an email from a client body or query string; never
  default a missing header to a writable "unknown" user); every downstream query is
  scoped by the internal `users.id` UUID; account deletion still cascades; the CSRF
  same-origin check on mutations still runs (see the origin-env note in §8).
- **Optional Spotify user-OAuth features** (history sync, like-track, save→playlist)
  belong to the personal NextAuth stack. On Sage expect them absent or inert — the
  code paths are designed to degrade (null token → 401 on the two `/api/spotify/*`
  routes, `playlistError` on saves, Last.fm/stats.fm remain full history sources).
  Verify degradation, don't resurrect the OAuth flow.

### 6.2 Database

- **Personal:** Supabase — anon-key browser client, server client with cookie
  bridging, and a service-role client for privileged writes; RLS enabled everywhere;
  RPC calls via PostgREST.
- **Sage:** a dedicated Postgres via injected `DATABASE_URL`, behind a server-side
  shim that emulates the query-builder surface the app uses, plus direct SQL. All DB
  access is server-side; the URL is never exposed to the client.
- **Verify:** (1) schema equivalence with the replay of migrations 0001–0041 —
  especially the Stage-2 objects: `artists`, uuid `artist_id` columns + uniques,
  partial indexes (`WHERE seen_at IS NULL`, the unresolved-name partial unique), and
  the `_v2` RPCs as real SQL functions with §5.3 semantics. (2) Since RLS/anon roles
  don't exist in this shape, **per-user scoping in application queries is the entire
  authorization layer** — every read/write against per-user tables must filter by the
  authenticated user's ID. (3) Connection pooling is conservative and initialization/
  migrations are explicit and idempotent.

### 6.3 Hosting & background work

- **Personal:** Vercel — serverless functions, `after()` bounded by function max
  duration, `vercel.json`, CSRF origins partly derived from `VERCEL_URL` vars.
- **Sage:** one Node 20 container (Docker, port 3000, `GET /api/health` fast-2xx,
  `npm ci && npm run build && npm start`). `after()` works self-hosted and is *less*
  constrained (no serverless timeout) — background tiers and color extraction simply
  run in-process after the response.
- Behavioral consequences to be aware of (improvements, not bugs): in-memory
  structures that were per-serverless-instance on Vercel — the circuit breakers, the
  onboarding window limiters, the Spotify client-token cache — become genuinely global
  in a single container. If Sage ever runs >1 replica, they're per-replica again, and
  the MusicBrainz 1-req/s limit **requires** the backfill job to run on exactly one
  process (§3).

### 6.4 Cron

- **Personal:** `vercel.json` — `GET /api/cron/recommendations` daily 03:00 UTC
  (expiry sweep) and `GET /api/cron/mb-backfill` daily 04:00 UTC (external-ID
  backfill), both gated by bearer `CRON_SECRET`.
- **Sage:** Sage cron (five-field schedule + plain Node command; best-effort, resets
  on redeploy, no missed-run catch-up) drives equivalent daily runs via runner
  scripts. Both jobs are already idempotent, bounded, and safe to skip — that's why
  best-effort is acceptable. Keep the batch caps so one run can't overlap the next.
- **Verify:** both jobs actually fire on Sage; whatever invocation path is used, the
  routes/scripts stay unreachable to normal users; the MusicBrainz `User-Agent`
  contact is a work address, not a personal one.

## 7. Deliberate quirks — do NOT "fix" these

1. `topTracks` tri-state asymmetry (`undefined` ≠ `[]`) — intentional negative cache
   (§4.2).
2. Onboarding limiters are per-instance in-memory — deliberate speed bump, documented
   in `lib/rate-limiter.ts` JSDoc with the upgrade path.
3. `rpc_delete_feedback_v2` leaves `seen_at` set while dismiss-undo clears it — the
   asymmetry is the product behavior (feedback undo ≠ resurface; dismiss undo =
   re-eligible).
4. Ambiguous `name_lower` reads as a cache miss — homonym safety (§3).
5. Explore artists don't enter the feed cooldown until acted on — known gap, tracked
   upstream; don't silently change it.
6. `hasMore`, wrapper-vs-inline body parsing quirks, and error-message texts listed in
   §5.7 are pinned observable behavior.
7. Dead-but-declared surface: `MusicProvider.getArtists` (batch), `createPlaylist`,
   `addTracksToPlaylist` have no callers; `Track.source='deezer'` is an empty slot.
   Leave them.
8. Legacy `groups`/`group_members`/`group_activity` tables may exist but the social
   feature was removed — ignore, don't rebuild.
9. `history/accumulate` can pass an empty Spotify token during a client-creds outage →
   silent 401s on the optional Spotify source. Known, low-priority upstream; Last.fm/
   stats.fm are unaffected.

## 8. Verification checklist (run on the Sage variant)

Local gates first: `npm run lint`, `npm test` (vitest), `npm run build` must pass from a
clean checkout. Then:

**Platform seams**
- [ ] `GET /api/health` returns fast 2xx without a session or third-party call.
- [ ] A request with no `x-impiricus-user-email` cannot reach any mutating route with a
      usable identity (no "unknown"-user writes).
- [ ] Identity is read in one server-side adapter only — `grep` for the header name;
      hits outside the adapter (and its tests) are drift.
- [ ] **CSRF origins:** `enforceSameOrigin` fails closed in production when no known
      origins are configured. The personal origin list leaned on `VERCEL_URL`-family
      vars that don't exist on Sage — confirm the deployed app URL is configured (e.g.
      `NEXT_PUBLIC_APP_URL` / equivalent) and that mutations (feedback POST) succeed
      from the app UI but a cross-origin POST is rejected. If every mutation 403s,
      this is the first place to look.
- [ ] `DATABASE_URL` never reaches the client bundle; no `NEXT_PUBLIC_*` secret.
- [ ] Schema audit vs migrations 0001–0041 (§6.2): `artists` table + uniques, uuid
      FKs, partial indexes, `_v2` functions present with revoked public EXECUTE (or
      the shim-equivalent privilege model).
- [ ] Both cron jobs fired within the last day and logged bounded batches.

**Product invariants**
- [ ] Fresh user: onboarding search returns suggestions with cache hits carrying
      uuids and Last.fm-only rows carrying `lf:` ids; selecting one resolves to a
      canonical uuid; seeds save; first generate fires.
- [ ] `POST /api/recommendations/generate` returns in seconds with `count ≤ 8`; the
      feed then grows past 8 without further user action (background tiers + client
      poll). No card ever renders without a playable preview.
- [ ] Generation makes **zero Spotify calls** on the resolve path (watch logs /
      counters — Spotify appears only as a preview *fallback* on artists that have a
      `spotify_id`).
- [ ] Explore returns four rails; a rail failure or cold user degrades (wildcards →
      leftfield fallback) without blanking the page; no genre exceeds 25% of a
      20-item feed or the cross-rail total.
- [ ] Thumbs-up → challenge progress increments once per transition; explore cache
      invalidates; thumbs-down artists never reappear; skip hides for 30 days;
      dismiss-undo makes the artist re-eligible.
- [ ] Settings: moving `popularity_curve` down measurably shifts results niche-ward;
      underground mode yields no artist with popularity > 50; changing any knob
      regenerates both surfaces asynchronously.
- [ ] History import from Last.fm and stats.fm populates `listened_artists`
      (name-only rows allowed) and respects the 15-min cooldown.
- [ ] Breakers: simulate iTunes 403s → breaker opens, confirm falls back / degrades,
      recovers after cooldown; a Spotify outage never blocks generation.
- [ ] Per-user isolation: user A's API calls can never read or mutate user B's rows
      (spot-check feedback, saves, history with two accounts).

## 9. Environment & configuration (names only — never commit values)

Required at runtime on any host: `LASTFM_API_KEY`; `SPOTIFY_CLIENT_ID` /
`SPOTIFY_CLIENT_SECRET` (preview fallback + any Spotify extras); `CRON_SECRET` (if the
HTTP cron routes are the invocation path); app-URL/origin var(s) for CSRF (§8).
Personal-only: `AUTH_SECRET`/`NEXTAUTH_SECRET`, `USERNAME_HMAC_SECRET`,
`USERNAME_ENCRYPTION_KEY`, `SUPABASE_*`. Sage-only: `DATABASE_URL` (injected), platform
`IMP_*` (reserved — never set manually). Secrets go through the platform's write-only
secret path; config through non-secret env.

## 10. Not in this baseline

- The personal repo has an in-flight branch (`feat/persist-preview-confirms`, issue
  #162) that persists preview-confirm outcomes to `artist_tracks_cache` during
  generation (adds `knownEmpty` to the `Artist` type, an `onConfirmOutcome` collector,
  and confirm-flush chaining across soften retries). It is **not merged to `main`** and
  not part of this spec. If it lands later, it arrives as a normal upstream diff — do
  not pre-implement it from this note.
- `docs/wiki/` pages inside the tree are a useful map but several predate the Stage-2
  identity cutover (notably `data-model.md` and `spotify-dependency.md` still describe
  `spotify_artist_id` as the primary key, and `music-providers.md` says `Artist.id` is
  a Spotify ID). **Where the wiki contradicts §3 of this document, this document is
  correct.** Updating those pages is welcome maintenance.
