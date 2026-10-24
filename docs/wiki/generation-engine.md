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
   `recommendation_cache`), and Last.fm `tag.gettopartists` (`lastfm.tagTopArtists`) for the
   user's top ~5 `selected_genres`. Deduped → `seedNames[]` (capped 10–15): the user's own
   `seed_artists` always come first (shuffled among themselves), then the likes + genre-tag
   fill (shuffled) — #175 F-A; before it, ~40 genre names in one shuffled pool dropped every
   picked seed from about half of first feeds. Picked seeds are also `knownNames` (never
   recommended back), even past the cap. Each genre requests the default 20 artists (before
   #175 F15 a `.map(getTagArtistNames)` quirk passed the array index, 0..4, as the limit).
2. **Soften gate** (`runWithSoftening`) — if the run returns `count=0`, retry with
   `playThreshold+5`, then fall back to `sampleColdStartSeeds()` from
   `data/cold-start-seeds.json`. A tier-1 *write error* (`PipelineRun.writeError`) is not an
   empty pool and never softens (#175 R7). Every run of one build shares one
   `ArtistIdentity`, so a discarded run's still-running secondary resolve can't race the next
   run into duplicate mints (#175 F-E).
3. **First-hop similarity** (`runPipeline`) — each seed →
   `lastfm.similarArtists` → **Last.fm `artist.getSimilar`** (7-day cached).
   Optional 2nd hop (`runDeepHop`) when `deep_discovery` is on.
4. **Round-robin ordering** (`buildRoundRobinNames`, `tailFirst=true`) — interleave
   candidates across seeds, lowest-match-first, so no mainstream seed floods the blocking
   slots.
5. **Pool split** (`splitResolvePools`) — first **36** names = blocking pool, next **54** =
   secondary (resolved later in `after()`). These caps (`resolve-pools.ts`) are the primary
   latency knob.
6. **Resolve** (`PlayableCandidates.resolve`, `playable-candidates.ts`) — the doorway
   (`ArtistIdentity`: name-cache → Last.fm `artist.getInfo` lookup → mint), keyed by the
   input name. Concurrency 6, 125ms spacing for the blocking pool. The resolved artist carries
   its roster row's `spotify_id` and (when set) popularity — a name landing on a homonym's
   Spotify row keeps the Spotify fallback and scores on the row's popularity (#175 F-F).
7. **Filter** (the `keep` gate, before rehydrate/confirm) — `Exclusions`
   (`exclusions.ts`: thumbs-down, listened over `playThreshold` by id or name key, thumbs-up
   or saved — Feed only, they never come back (D1, #175 F-B) — and the 7-day seen /
   dismissed cooldown), popularity>50 under underground mode, optional genre filter.
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
13. **Write Tier 1** (`writeScored`) — write ≤8 rows to `recommendation_cache` (re-checks
    cooldown fresh from the DB as a safety net; a failed read writes nothing). New artists:
    one upsert with no `seen_at`/`skip_at`/`created_at` (DB defaults). Existing rows: a
    conditional UPDATE per row that lands only if the row still has the `seen_at` we read and
    no `skip_at` (#175 R4), so a dismiss / thumbs-down / save racing the write is never undone.
    Rewrites get `created_at: now` so the nightly 3-day unseen expiry doesn't drop them again
    (#175 F-C). An artist the user only scrolled past (seen > 7 days ago, no feedback, save or
    `skip_at`) **resurfaces** with `seen_at: null` (owner decision D1, #175 F26). The feed
    query and `hasFreshRecs` also skip any `skip_at` row (defense in depth).
14. **Return fast** — the result carries `count`, `pending`, one `finish()` continuation,
    and `metrics`.
15. **Background** (`finish()` via `after()`) — confirm the rest of the primary pool
    (Tier 2, ≤12) then the secondary pool (≤20), writing each batch; then flush every soften
    run's confirm outcomes to `artist_tracks_cache` (even if the secondary pass threw).

## Key modules (`lib/recommendation/`)

| Module | Purpose |
|---|---|
| `engine.ts` | the orchestrator above (seeds, fan-out, scoring, bleed, tiers, `finish()`) |
| `playable-candidates.ts` | the shared name → confirmed-playable pipeline (resolve, `keep` gate, rehydrate, confirm, flush) used by Feed tiers/backfill/bleed and every Explore rail; `livePlayablePorts(token)` wires Last.fm getInfo, iTunes, Spotify top-tracks |
| `exclusions.ts` | the one "never show this artist" policy (`loadExclusions(supabase, userId, { playThreshold \| 'any', nameFallback, liked? }, now?, preloaded?)`; Explore passes its already-in-flight listened / thumbs-down reads). Every read is keyset-paged on `id` (`readAllRows`, #175 R8); a mid-read page error keeps the rows read so far (logged) |
| `preview-store.ts` | `PreviewStore`: the ONLY code touching `artist_tracks_cache` — confirm read (`rehydrate`), display read, outcome collector, tracks-route read/refresh/write; one 24h TTL; poisoning guard on tracks-route writes (collector writes satisfy it by construction, #175 E4a) |
| `resolve-candidates.ts` | name → Artist resolver (cache → Last.fm `getInfo` resolve; Spotify-free since #157), 429 backoff |
| `resolve-pools.ts` | blocking (36) / secondary (54) split; latency knobs |
| `confirm-previews.ts` | iTunes-first / Spotify-fallback playability confirm |
| `cluster-cap.ts` | 25% per-genre diversity cap (single-list + cross-rail) |
| `scoring` (in engine) | `k^popularity` tier multiplier + relevance |
| `window.ts` | weekly-stable seeds: `cacheWindowSeed`, `seededShuffle`, `sampleLikes` |
| `freshness.ts` | "has ≥5 unseen unexpired recs?" for splash redirect |
| `gen-timing.ts` (+ `lib/metrics/api-call-counter.ts`) | instrumentation (`[gen-timing]` logs) |

Outside this folder: Last.fm calls go through `lib/lastfm` (one adapter), name → uuid
through `lib/artist-identity` (with `lastfm-lookup.ts` = `lastfmResolve`, `buildEnrichArtist`,
`mergeEnrichment`), previews through `lib/music-provider/{itunes,spotify}.ts`. See
[[music-providers]].

## Important truths

- **Last.fm is the graph engine.** Similarity, tags, getInfo and search all go through the
  one adapter `lib/lastfm` ([[music-providers]]).
- **Genres + popularity come from Last.fm enrichment**, because Spotify's search response
  returns empty genres / zero popularity (and as of Feb 2026 Spotify *removed* popularity
  and deprecated genres — [[spotify-dependency]]). getInfo enrichment
  (`buildEnrichArtist`) is effectively required for scoring to work.
- **iTunes is the primary preview source.** The Spotify top-tracks fallback may already be
  dead for client-credentials (Feb 2026 removal) — verify in logs.
- **Preview cache tri-state** (`artist_tracks_cache`, owned by `PreviewStore`): no row =
  unknown; `[]` = confirmed-empty negative (honored 24h by confirm reads); `[..]` =
  playable (no TTL for confirm/display reads; the tracks route refreshes after 24h, and
  serves the stale positive unchanged when that refresh fails — #175 F-H). An iTunes
  *failure* never writes a negative.
- **Doorway fill-only write** (`ArtistIdentity.write`): popularity 0 counts as empty (#175
  R2); it reuses the row `ensure()` landed on instead of a second SELECT per resolved miss
  (one serial round-trip saved per miss on the blocking path).
- **Two-phase write:** the HTTP `count` reflects only Tier-1 (8). Callers must run
  `finish()` in `after()`.

## Gotchas worth knowing

- `FIRST_BATCH_TARGET = 8` is hardcoded; not per-user settable.
- `chain-walker.ts` (speculative multi-hop BFS) was deleted 2026-07-11 — it had zero callers.
- Explore artists only land in `recommendation_cache` (and the 7-day cooldown) once the
  user *acts* on them — a behavioral gap vs the Feed.
- Last.fm tags hyphenated in flipside's tree (e.g. `dutch-black-metal`) may return 0 from
  Last.fm; `lastfm.tagTopArtists` retries with spaces (a second sequential call) — this was
  the Explore leftfield-rail latency cause.
