---
title: Spotify-API-Independence Plan (v5 — two review rounds: 6 code + 4 security + 5 red-team)
updated: 2026-06-06
status: reviewed twice; ready to slice into issues. Stage 2 detail + Round-2 corrections → docs/spotify-removal-checklist.md
related: docs/spotify-removal-checklist.md, docs/wiki/spotify-dependency.md, docs/wiki/data-model.md, docs/wiki/music-providers.md, docs/future-per-track-open-links.md, docs/council/2026-06-06-spotify-removal.md
---

# Plan: Drive shared-Spotify-key ratelimit risk to ~zero

## Review outcome (6 code-verified reviews + 4 security agents)
Surrogate-UUID Stage 2 is the **right** call (unanimous). As written, v3 confidence was
LOW (15–35%) — it would have shipped broken. With the fixes now in
**`docs/spotify-removal-checklist.md`**, confidence rises to ~85–90%. The must-fixes the
reviews surfaced (all code-verified):
- **3 omitted schema blockers:** `artist_search_cache` (hottest read path) was out of scope;
  `artist_tracks_cache` + `artist_external_links` have `spotify_artist_id` as their PRIMARY
  KEY (PK surgery, not a column add); `explore_cache.artist_ids TEXT[]` holds Spotify IDs
  (wipe it — 24h TTL).
- **RPCs:** rewrite 3 RPCs `p_artist_id TEXT→UUID` atomically; `CREATE OR REPLACE` with a
  changed type makes a NEW PUBLIC-executable overload → must REVOKE the new signature **and**
  DROP the old one (🔴 the top security item).
- **The "collapse artist.search + getInfo" claim is FALSE** — `artist.search` returns no
  genres; keep `getInfo` but CACHE it (+ search) and add per-endpoint Last.fm counters +
  `runLastfm` spacing, or the swap just moves the SPOF to Last.fm.
- **Identity-mint guard:** add a `stringSimilarity ≥ 0.8` check before the resolver's `res[0]`
  fallback (Last.fm is less authoritative than Spotify → cross-user cache poisoning) and
  mint `artists` rows race-safely (`on conflict do nothing` + read-back).
- **MB backfill worker** must be a single-process cron, `CRON_SECRET`-gated.
- **Guards:** `isValidSpotifyId`→`isValidArtistId` (uuid) at identity routes; KEEP it at
  `spotify/like`, `spotify/resolve-track`, and (deferred) the apple/tracks routes until their
  tables re-key. Split the dual-purpose id field into `id` (uuid) + `spotifyId` (attribute).
- **No live Critical security vulns** in current code; risks are migration-introduced and
  enumerated in the checklist §G.

**Round 2 (5 red-team agents on the v4 checklist itself)** found defects in the *fixes*, now
captured in checklist §H — the architecture held but the cutover mechanics didn't:
- **Not "one atomic cut" — split into 2 migrations** (create-new-keep-old → deploy → drop-old);
  keep old columns/constraints/RPCs alive through the deploy window or every write 400s mid-deploy
  and rollback breaks.
- **Preview shares the PROD Supabase DB** (no staging) → rehearse Stage 2 on a **local** DB only;
  never `db push --linked` to test.
- **`name_lower` must be non-unique** on `artists` (homonym artists collide); dedupe on
  spotify_id/mbid.
- **getInfo caching is mandatory** (not optional) — true first-ever cold gen is ~100–145 Last.fm
  calls (not the ~20–30 second-gen figure); without the cache, Stage 2 just moves the SPOF.
  Token-bucket is per-process, not per-IP.
- Plus the exact `artist-name-cache.ts:110` write, 2 missing RPC DROPs, `stats/page.tsx`,
  `artist_data` JSONB embedded id, feed-fill dedup-key atomicity, FK `ON DELETE` — all in §H.
- **Confirmed good:** Stage 1 is genuinely independent; no live Critical vulns; IDOR clean;
  open-link forgery not exploitable. Revised confidence with §H folded in: ~90%.

Full implementation + verification + security checklist (incl. Round-2 §H): **`docs/spotify-removal-checklist.md`**.

## Goal (user's words)
*"Reduce the possibility of a ratelimit greatly, if not all the way to zero."* Keep "Open in
Spotify" working. Solo dev; can test on localhost before going live. One shared key set
across local/preview/prod, so measure by **request-count**, not wall-clock. **App is
pre-release** (close friends only) — so a one-time identity migration is cheap *now* and only
gets more expensive with users.

## Success metric
Shared Spotify client-credentials calls per cold-user generation and per onboarding session
→ **0**, with **no new ratelimit SPOF on Last.fm** (verified via per-endpoint counters,
Last.fm cold-gen volume ≤ today's).

---

## Why a real identity migration now (and why surrogate-UUID, not MBID)
Verified hinge finding (see `docs/council/2026-06-06-spotify-removal.md`): `spotify_artist_id`
is **not** a display label. `isValidSpotifyId` (`/^[a-zA-Z0-9]{22}$/`) guards **9 routes**;
the column is `NOT NULL` and the dedup/feedback/cooldown key in 5+ tables; the name-cache
writes it cross-user. So any move off Spotify search forces an identity decision.

The clean, lowest-future-cost endpoint is an **internal surrogate UUID primary key**, with
`spotify_id` / `mbid` / `apple_id` / `deezer_id` as **nullable attributes**:
- **No external backfill gate** — mint UUIDs and remap `spotify_id → uuid` in pure SQL
  (existing artists already have Spotify IDs). MBID/Apple/Deezer become *lazy* attributes.
- **It's the last identity migration ever** — the PK owes nothing to any provider.
- **Kills the reconciliation tax** — one ID space; no duplicate-artist rows; no merge logic.

(Rejected: MBID-as-PK — not every artist has an MBID, and it would impose a slow MusicBrainz
backfill gate. "2a/keep-the-column" — leaves a permanent mixed-meaning key + merge tax.)

## Migration sizing (measured live, 2026-06-06 — `scripts/_migration-sizing.ts`)
| Identity table | rows to re-key |
|---|---|
| recommendation_cache | 1,404 |
| listened_artists | 921 |
| seed_artists | 90 |
| feedback | 47 |
| saves | 37 |
| artist_tracks_cache | 1,805 |
| **total** | **~4,300** |

Distinct artists (→ `artists` table): **~6,004** (from `artist_search_cache`; per-user tables
are subsets). **Conclusion: the migration is pure SQL over ~4.3k rows → sub-second.** Existing
artists already carry Spotify IDs (6,004 distinct / 6,102 rows) → they become attributes with
zero external calls. Optional later MB enrichment for *extra* platform IDs ≈ 6k ÷ 1 req/s ≈
~100 min one-time background, never blocking. **The cost is code churn, not data.**

---

## The three Spotify shared-key sites to eliminate
1. `/api/onboarding/search` — Spotify search **per keystroke** (#1 burner). Low identity impact.
2. Generation candidate resolution (`resolve-candidates.ts`) — Spotify search, burst 36–90/gen.
3. `history/accumulate` ID resolution (`id-resolver.ts`).
Already non-Spotify: similar/genres/popularity = Last.fm; previews = iTunes.

---

## Stage 1 — Cache-max + onboarding-first (HIGH confidence, ~days, NO schema change) — SHIP IN PARALLEL
Independent of the migration; delivers the biggest ratelimit cut immediately. **Do not let
the migration hold this up.**
- **Onboarding typeahead off the hot Spotify path:** server-side debounce + min-length (≥2–3);
  serve suggestions **cache-first** (`artist_search_cache` ILIKE) then **Last.fm `artist.search`**
  on miss (suggestions need only name/image to display). Resolve the few *selected* seeds'
  Spotify IDs cache→MusicBrainz (low volume).
- **Aggressively pre-warm `artist_search_cache` offline** (`scripts/seed-artist-cache.ts` +
  `backfill-artist-genres.ts`, already MB+Last.fm). *Biggest schema-free ratelimit lever.*
  (Audit these scripts first: must not use the removed Spotify batch `/artists?ids=`.)
- **Cache BOTH `artist.search` and `artist.getInfo`** (Supabase, 7-day TTL, e.g.
  `lastfm_cache kind='enrichment'`). NOTE: `artist.search` returns no genres, so it does NOT
  replace `getInfo` — keep getInfo for genres, just make it cache-hit on warm artists (→ ~0
  live calls warm; ~20–30 cold). `artist.search` can supply listeners/mbid.
- **Add `runLastfm` spacing / token-bucket (~≤4 req/s) + per-endpoint Last.fm counters**
  (`incLastfmSearch/Similar/TagTop/GetInfo` — they don't exist yet and are the success-metric gate).
- **Bug fixes that bite this:** guard `getSpotifyTopTracks` fallback (don't 404-trip the
  breaker on non-Spotify ids); fix `history/route.ts` `hasMore`; stop `history/accumulate`
  passing `""` as a token.
- *Localhost test:* onboarding shows 0 Spotify calls after debounce; cold-gen Spotify
  call-count drops sharply, Last.fm count ≤ baseline.
- *Rollback:* config/flags; trivial.

## Stage 2 — Surrogate-UUID identity migration, THEN Last.fm resolver (MED-HIGH confidence, ~1 wk; data trivial, churn is the work)

### 2.1 Schema (new canonical artist record)
- Create **`artists`**: `id uuid pk default gen_random_uuid()`, `spotify_id text unique null`,
  `mbid text unique null`, `apple_id text null`, `deezer_id text null`, `name text`,
  `name_lower text not null` (**NON-unique** — see line 42 / checklist §H3; homonyms must coexist),
  plus the metadata currently in `artist_search_cache.artist_data`
  (genres, popularity, image_url, color). RLS + **explicit GRANTs** (cross-user readable;
  service-role write) — see Data-API-GRANTs risk below.
- Backfill `artists` from distinct `artist_search_cache` rows (have spotify_id + metadata);
  insert any spotify_artist_id present in per-user tables but missing from cache.
- Build a `spotify_id → artists.id` map (pure SQL, no external calls).

### 2.2 Re-key the per-user/identity tables
- Add `artist_id uuid references artists(id)` to `recommendation_cache`, `feedback`, `saves`,
  `seed_artists`, `listened_artists`, `artist_tracks_cache`, `artist_external_links`.
- `UPDATE … FROM` the map to populate `artist_id`. Add NOT NULL + FK; swap unique constraints
  / `onConflict` keys to `(user_id, artist_id)`; rebuild the partial/hot indexes on
  `artist_id`. **Keep the old `spotify_artist_id` columns (nullable) through the transition
  for rollback; drop in a later migration.**
- **Rewrite the SQL RPCs** that take/þuse `spotify_artist_id`: `rpc_record_feedback`,
  `rpc_delete_feedback`, `rpc_clear_dismiss`, `rpc_increment_challenge_progress` (verify each
  in `supabase/migrations/0020*`+). These are a major, easily-missed surface.

### 2.3 Application + client
- Replace the **9 `isValidSpotifyId` guards** with `isValidArtistId` (uuid) — or an
  "artist exists" check; keep `isValidSpotifyId` only where a *Spotify track/artist id* is
  genuinely required (the optional user-token features).
- Artist payload now carries internal `id` (uuid, used by feedback/saves/dismiss/tracks API
  calls) **plus** `spotifyId`/`appleId`/… attributes for links. Update components
  (`artist-card`, `track-strip`, explore rows, saved, history, settings) to send `id` and
  build links from the attributes (`open.spotify.com/artist/{spotifyId}` else search-URL).
- `engine.ts`/`explore-engine.ts` writes key on `artist_id`; `artist-name-cache.write` writes
  the canonical record (no cross-user poisoning possible — id is internal).

### 2.4 Resolver swap (now safe — key no longer must be a Spotify ID)
- Generation + history resolution → **Last.fm `artist.search`** (cached/collapsed/spaced from
  Stage 1). New artists get a fresh `artists` row (uuid) immediately; `spotify_id` filled if
  known, else **lazy MB backfill** (global `runMusicBrainz` 1 req/s limiter, DB-serialized).
- "Open in Spotify": stored `spotify_id` → else `open.spotify.com/search/{name}`. Honor
  `preferred_music_platform`.

### 2.5 Verify (the gate)
- Rehearse on a **seeded localhost DB** (dump prod schema + a sample): run the migration, then
  unset `SPOTIFY_CLIENT_ID/SECRET` and as a cold user **exercise onboarding, generate a feed,
  and thumbs-up / thumbs-down / save / dismiss / open-link / lazy-tracks** on a freshly
  Last.fm-resolved artist. Confirm `[gen-timing] spotify: 0`, no 400s, links + previews work.
- Re-run `scripts/_migration-sizing.ts` immediately before the real migration for fresh counts.

## Stage 3 — Optional enhancements (LOW priority, gated)
- **Deezer**: only after a **Vercel-function reachability spike** passes AND non-commercial
  ToS is acceptable. Inconsistent reachability today; never load-bearing.
- **Better artist images**: TheAudioDB (real artist photos, free) or Wikidata P18 → Commons
  (CC, cacheable, MBID-keyed) — both beat iTunes album art.
- **Per-track "Open in …" links** (separate, deferred): iTunes-as-track-of-record unblocks
  Apple/YouTube per-track + a zero-API Spotify fallback. Full context: `docs/future-per-track-open-links.md`.

---

## Where Spotify is still needed or genuinely nice-to-have
- **Optional per-user connect** (history sync, like, save→playlist): keep — uses the user's
  **own token**, never the shared key. No cold-user ratelimit risk.
- **"Open in Spotify"**: keep — stored `spotify_id` attribute → search-URL fallback. Zero API.
- **Exact per-track Spotify links** (future): on-click, user-token only — not a ratelimit risk.
- After Stage 2, nothing on the **shared** key.

## Risks (carry into implementation; re-checked by the exhaustive review round)
- **Last.fm becomes the new SPOF** unless `artist.search` is cached + collapsed with
  `getInfo` + spaced. (HIGH — Stage 1 must land first.)
- **Migration completeness:** every `spotify_artist_id` read/write site (engine, explore,
  routes, history, hooks, components, scripts) AND the SQL RPCs must move to `artist_id`. The
  review round produces the exhaustive checklist. (HIGH — churn surface.)
- **RLS / Supabase Data API GRANTs:** the new `artists` table needs explicit GRANTs before the
  policy cutover (defaults 2026-05-30; existing projects 2026-10-30). (MED)
- **Last.fm `artist.search` disambiguation** (listener-ranked, no market) — add a name-match
  guard + confidence threshold. (MED)
- **Dedup during migration:** if the same artist exists under two Spotify IDs, the `artists`
  unique(spotify_id) backfill must merge, not error. (MED)
- **Images:** iTunes art is album-level — visible downgrade until TheAudioDB/Wikidata. (MED)
- **Deezer ToS** is a categorical blocker for a monetized product regardless of reachability.

## Fallback ladder (most → least conservative)
- **F0:** Stage 1 only — cache-max + onboarding debounce/cache-first. Big cut, days, no schema. → *greatly reduced*.
- **F1 (recommended): Stage 1 + Stage 2 (surrogate-UUID).** Shared-key calls → 0; clean,
  future-proof identity; migration is sub-second at current data. → *all the way to zero*.
- **F2: + Stage 3** Deezer / TheAudioDB / Wikidata / per-track links (each gated).
