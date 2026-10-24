---
title: Generation Engine (Feed)
updated: 2026-10-24
related: [[explore-engine]], [[music-providers]], [[external-apis]], [[genre-system]], [[data-model]]
---

# Generation Engine (Feed)

The Feed ("For You") pipeline. Entry point: `buildRecommendations(input)` in
`lib/recommendation/engine.ts` (the core). Explore shares the same
`PlayableCandidates` pipeline (resolve → exclusions → rehydrate → confirm → persist) — see
[[explore-engine]].

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
6. **Resolve** (`PlayableCandidates.resolve`, `playable-candidates.ts`) — the doorway
   (`ArtistIdentity`: name-cache → Last.fm `artist.getInfo` lookup → mint), keyed by the
   input name. Concurrency 6, 125ms spacing for the blocking pool.
7. **Filter** (the `keep` gate, before rehydrate/confirm) — `Exclusions`
   (`exclusions.ts`: thumbs-down, listened over `playThreshold` by id or name key, 7-day
   seen / dismissed cooldown), popularity>50 under underground mode, optional genre filter.
   Then **rehydrate** from `artist_tracks_cache` via `PreviewStore`.
8. **Score** (`scoreCandidate` / `tierMultiplier`) —
   `k^popularity × 0.8 + seedRelevance × 0.2 − adventurousPenalty`, where `k` =
   `popularity_curve`. See [[settings-and-discovery]].
9. **Greedy diversity** (`greedyPickTop`) — top 40 → pick 20 with soft per-genre (10%) and
   per-seed (8%) penalties.
10. **Hard cluster cap** (`applyClusterCap`, `cluster-cap.ts`) — no genre > **25%** of the
    20-item feed. See [[genre-system]].
11. **Adjacent-genre bleed** (`augmentWithAdjacent`) — inject 4–10 picks from
    close/medium adjacent tags at positions 5–7+ (skipped when a `genre` filter is active).
12. **Confirm previews — Tier 1** (`PlayableCandidates.confirm` → `confirmToTarget` /
    `confirm-previews.ts`) — first 8 artists, in waves: rehydrated cache → **iTunes**
    `search?entity=song` → **Spotify `/artists/{id}/top-tracks`** fallback. Artists with no
    playable preview are **dropped**. Every live outcome is collected for persistence.
13. **Write Tier 1** (`writeScored`) — upsert ≤8 rows to `recommendation_cache` (re-checks
    cooldown fresh from the DB as a safety net).
14. **Return fast** — the result carries `count`, `pending`, one `finish()` continuation,
    and `metrics`.
15. **Background** (`finish()` via `after()`) — confirm the rest of the primary pool
    (Tier 2, ≤12) then the secondary pool (≤20), writing each batch; then flush every soften
    run's confirm outcomes to `artist_tracks_cache` (even if the secondary pass threw).

## Key modules (`lib/recommendation/`)

| Module | Purpose |
|---|---|
| `engine.ts` | the orchestrator above; also `getTagArtistNames`, `buildConfirmPreview` |
| `playable-candidates.ts` | the shared name → confirmed-playable pipeline (resolve, `keep` gate, rehydrate, confirm, flush) used by Feed tiers/backfill/bleed and every Explore rail |
| `exclusions.ts` | the one "never show this artist" policy (`loadExclusions(supabase, userId, { playThreshold \| 'any', nameFallback })`) |
| `preview-store.ts` | `PreviewStore`: the ONLY code touching `artist_tracks_cache` — confirm read (`rehydrate`), display read, outcome collector, tracks-route read/refresh/write; one 24h TTL; poisoning guard on every write |
| `resolve-candidates.ts` | name → Artist resolver (cache → Last.fm `getInfo` resolve; Spotify-free since #157), 429 backoff |
| `resolve-pools.ts` | blocking (36) / secondary (54) split; latency knobs |
| `confirm-previews.ts` | iTunes-first / Spotify-fallback playability confirm |
| `enrich-artist.ts` | Last.fm `artist.getInfo` → fills genres + popularity (see below) |
| `cluster-cap.ts` | 25% per-genre diversity cap (single-list + cross-rail) |
| `scoring` (in engine) | `k^popularity` tier multiplier + relevance |
| `window.ts` | weekly-stable seeds: `cacheWindowSeed`, `seededShuffle`, `sampleLikes` |
| `freshness.ts` | "has ≥5 unseen unexpired recs?" for splash redirect |
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
- **Preview cache tri-state** (`artist_tracks_cache`, owned by `PreviewStore`): no row =
  unknown; `[]` = confirmed-empty negative (honored 24h by confirm reads); `[..]` =
  playable (no TTL for confirm/display reads; the tracks route refreshes after 24h). An
  iTunes *failure* never writes a negative.
- **Two-phase write:** the HTTP `count` reflects only Tier-1 (8). Callers must run
  `finish()` in `after()`.

## Gotchas worth knowing

- `FIRST_BATCH_TARGET = 8` is hardcoded; not per-user settable.
- `chain-walker.ts` (speculative multi-hop BFS) was deleted 2026-07-11 — it had zero callers.
- Explore artists only land in `recommendation_cache` (and the 7-day cooldown) once the
  user *acts* on them — a behavioral gap vs the Feed.
- Last.fm tags hyphenated in flipside's tree (e.g. `dutch-black-metal`) may return 0 from
  Last.fm; `fetchTagArtistNames` retries with spaces (a second sequential call) — this was
  the Explore leftfield-rail latency cause.
