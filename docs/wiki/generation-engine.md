---
title: Generation Engine (Feed)
updated: 2026-06-06
related: [[explore-engine]], [[music-providers]], [[external-apis]], [[genre-system]], [[data-model]]
---

# Generation Engine (Feed)

The Feed ("For You") pipeline. Entry point: `buildRecommendations(input)` in
`lib/recommendation/engine.ts` (~45KB, the core). Explore shares this resolver/confirm
core — see [[explore-engine]].

## Pipeline (in order)

1. **Gather seeds** (`gatherSeedContext`) — three parallel Supabase sources:
   `seed_artists`, a stable weekly sample of thumbs-up artists (`sampleLikes`, via
   `recommendation_cache`), and Last.fm `tag.gettopartists` for the user's top ~5
   `selected_genres`. Shuffled + deduped → `seedNames[]` (capped 10–15).
2. **Soften gate** (`runWithSoftening`) — if the run returns `count=0`, retry with
   `playThreshold+5`, then fall back to `sampleColdStartSeeds()` from
   `data/cold-start-seeds.json`.
3. **First-hop similarity** (`runPipeline`) — each seed →
   `musicProvider.getSimilarArtistNames` → **Last.fm `artist.getSimilar`** (7-day cached).
   Optional 2nd hop (`runDeepHop`) when `deep_discovery` is on.
4. **Round-robin ordering** (`buildRoundRobinNames`, `tailFirst=true`) — interleave
   candidates across seeds, lowest-match-first, so no mainstream seed floods the blocking
   slots.
5. **Pool split** (`splitResolvePools`) — first **36** names = blocking pool, next **54** =
   secondary (resolved later in `after()`). These caps (`resolve-pools.ts`) are the primary
   latency knob.
6. **Resolve** (`resolveArtistsByName`, `resolve-candidates.ts`) — cache-first against
   `artist_search_cache`; misses → **Spotify `/search`** (token: `userAccessToken ??
   clientToken`), with **Last.fm `artist.getInfo`** enrichment fired in parallel. Backoff
   budget 90s total / 20s per name; concurrency 6, 125ms spacing. On breaker-open 429 it
   **skips retry** immediately.
7. **Filter** — drop thumbs-down, listened-over-`playThreshold`, popularity>50 under
   underground mode, optional genre filter.
8. **Score** (`scoreCandidate` / `tierMultiplier`) —
   `k^popularity × 0.8 + seedRelevance × 0.2 − adventurousPenalty`, where `k` =
   `popularity_curve`. See [[settings-and-discovery]].
9. **Greedy diversity** (`greedyPickTop`) — top 40 → pick 20 with soft per-genre (10%) and
   per-seed (8%) penalties.
10. **Hard cluster cap** (`applyClusterCap`, `cluster-cap.ts`) — no genre > **25%** of the
    20-item feed. See [[genre-system]].
11. **Adjacent-genre bleed** (`augmentWithAdjacent`) — inject 4–10 picks from
    close/medium adjacent tags at positions 5–7+ (skipped when a `genre` filter is active).
12. **Confirm previews — Tier 1** (`confirmToTarget` / `confirm-previews.ts`) — first 8
    artists, in waves: cache → **iTunes** `search?entity=song` → **Spotify
    `/artists/{id}/top-tracks`** fallback. Artists with no playable preview are **dropped**.
13. **Write Tier 1** (`writeScored`) — upsert ≤8 rows to `recommendation_cache`; also write
    confirmed `topTracks` back into `artist_search_cache` (warm-reuse, #145).
14. **Return fast** — response carries `count`, a `runSecondary` closure, and `metrics`.
15. **Background** (`runSecondary` via `after()`) — confirm the rest of the primary pool
    (Tier 2, ≤12) then the secondary pool (≤20), writing each batch.

## Key modules (`lib/recommendation/`)

| Module | Purpose |
|---|---|
| `engine.ts` | the orchestrator above; also `getTagArtistNames`, `buildConfirmPreview` |
| `resolve-candidates.ts` | name → Artist resolver (cache → Spotify search), 429 backoff |
| `resolve-pools.ts` | blocking (36) / secondary (54) split; latency knobs |
| `confirm-previews.ts` | iTunes-first / Spotify-fallback playability confirm |
| `enrich-artist.ts` | Last.fm `artist.getInfo` → fills genres + popularity (see below) |
| `cluster-cap.ts` | 25% per-genre diversity cap (single-list + cross-rail) |
| `scoring` (in engine) | `k^popularity` tier multiplier + relevance |
| `chain-walker.ts` | BFS similarity-chain finder (used 1-hop for Explore provenance) |
| `artist-name-cache.ts` | read-through cache over `artist_search_cache` (chunked at 500) |
| `window.ts` | weekly-stable seeds: `cacheWindowSeed`, `seededShuffle`, `sampleLikes` |
| `freshness.ts` | "has ≥5 unseen unexpired recs?" for splash redirect |
| `user-market.ts` | DB-cached Spotify market, falls back to "US" |
| `tracks-handler.ts` | lazy `GET /api/artists/:id/tracks` (iTunes) — see [[api-routes]] |
| `api-call-counter.ts` / `gen-timing.ts` | instrumentation (`[gen-timing]` logs) |

## Important truths

- **Last.fm is the graph engine.** `getSimilarArtistNames` lives on `SpotifyProvider` but
  makes **only Last.fm calls** ([[music-providers]]).
- **Genres + popularity come from Last.fm enrichment**, because Spotify's search response
  returns empty genres / zero popularity (and as of Feb 2026 Spotify *removed* popularity
  and deprecated genres — [[spotify-dependency]]). `enrich-artist.ts` is effectively
  required for scoring to work.
- **iTunes is the primary preview source.** The Spotify top-tracks fallback may already be
  dead for client-credentials (Feb 2026 removal) — verify in logs.
- **Negative cache:** `topTracks: []` means "confirmed no preview" and skips the network;
  `undefined` means "unconfirmed". This asymmetry is intentional.
- **Two-phase write:** the HTTP `count` reflects only Tier-1 (8). Callers must run
  `runSecondary()` in `after()`.

## Gotchas worth knowing

- `FIRST_BATCH_TARGET = 8` is hardcoded; not per-user settable.
- `chain-walker.ts` multi-hop BFS is built + tested but only used 1-hop in production.
- Explore artists only land in `recommendation_cache` (and the 7-day cooldown) once the
  user *acts* on them — a behavioral gap vs the Feed.
- Last.fm tags hyphenated in flipside's tree (e.g. `dutch-black-metal`) may return 0 from
  Last.fm; `fetchTagArtistNames` retries with spaces (a second sequential call) — this was
  the Explore leftfield-rail latency cause.
