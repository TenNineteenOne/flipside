---
title: Generation Engine (Feed)
updated: 2026-11-12
related: [[music-providers]], [[external-apis]], [[genre-system]], [[data-model]]
---

# Generation Engine (Feed)

The Feed ("For You") pipeline. Entry point: `buildRecommendations(input)` in
`lib/recommendation/engine.ts` (the core). The Explore page (and its rails engine) was
folded into Feed and removed on 2026-11-10 (#205); its two discovery rails live on as the
Wander farther far pool (step 10).

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
   empty pool and never softens (#175 R7). A zero-top run aborts its own far and bleed
   resolves (an `AbortSignal` the resolver checks between names) so they stop competing
   with the next run for the Last.fm gate and the DB. Every run of one build shares one
   `ArtistIdentity`, so a discarded run's still-running secondary resolve can't race the next
   run into duplicate mints (#175 F-E).
3. **First-hop similarity** (`runPipeline`) — each seed →
   `lastfm.similarArtists` → **Last.fm `artist.getSimilar`** (7-day cached; one batched
   `lastfm_cache` read for all seeds, and one for the 2nd-hop names, via `lastfm.prefetch`).
   Optional 2nd hop (`runDeepHop`) when **Wander farther** (`users.adventurous`) is on — the
   route passes `deepDiscovery = adventurous` (#205; `deep_discovery` is retired).
   Under Wander farther the **far-pool fetch** (`startFarFetch` → `far-picks.ts`) is started
   once per build right after seed gathering, so it overlaps the first hop; see step 10.
4. **Round-robin ordering** (`buildRoundRobinNames`, `tailFirst=true`) — interleave
   candidates across seeds, lowest-match-first, so no mainstream seed floods the blocking
   slots.
5. **Pool split** (`splitResolvePools`) — first **36** names = blocking pool, next **54** =
   secondary. The secondary resolve starts only once the run has a non-empty pick (after
   step 9), so it never competes with the primary resolve for the Last.fm gate and a
   zero-top run never pays for it; its confirm/write runs in `after()`. These caps
   (`resolve-pools.ts`) are the primary latency knob.
6. **Resolve** (`PlayableCandidates.resolve`, `playable-candidates.ts`) — the doorway
   (`ArtistIdentity`: name-cache → Last.fm `artist.getInfo` lookup → mint), keyed by the
   input name. Concurrency 6 and **no per-worker spacing** for the blocking pool, the bleed
   and the far pool (the Last.fm gate — 12 in flight, 20/s, 200 burst — is the one pacing
   control; the old 125 ms spacing cost ~1.3 s per cold build). The background secondary
   resolve keeps the resolver defaults (4 workers, 200 ms). Before the workers start, one
   batched `lastfm_cache` read covers every miss's getInfo (`lastfm.prefetch`). The resolved artist carries
   its roster row's `spotify_id` and (when set) popularity — a name landing on a homonym's
   Spotify row keeps the Spotify fallback and scores on the row's popularity (#175 F-F).
7. **Filter** (the `keep` gate, before rehydrate/confirm) — `Exclusions`
   (`exclusions.ts`: thumbs-down, listened over `FEED_PLAY_THRESHOLD` (fixed at **5** since
   #205; `users.play_threshold` is retired) by id or name key, thumbs-up
   or saved — Feed only, they never come back (D1, #175 F-B) — and the 7-day seen /
   dismissed cooldown), popularity>50 at fame level 0 ("Underground only"), optional genre filter.
   Exclusions start loading before the seed gather: every exclusion read (listened,
   thumbs-down, cooldown seen/skipped, thumbs-up, saves) runs once per build
   (`preloadExclusionRows`) and is shared by every soften run; the gather reuses the same
   thumbs-up read.
   Then **rehydrate** from `artist_tracks_cache` via `PreviewStore`.
8. **Score** (`scoreCandidate` / `tierMultiplier`) —
   `k^popularity × 0.8 + seedRelevance × 0.2 − adventurousPenalty`, where `k` comes from
   `users.fame_level` via `fameToEngine` (`lib/settings/fame.ts`). See [[settings-and-discovery]].
9. **Greedy diversity** (`greedyPickTop`) — top 40 → pick 20 with soft per-genre (10%) and
   per-seed (8%) penalties.
10. **Exploration budget** (`augmentWithAdjacent`) — replace the lowest-scored picks past the
    top few (skipped when a `genre` filter is active):
    - **Wander farther off:** 4 slots from position 5, close-genre adjacent bleed only.
    - **Wander farther on:** 10 slots from position 3, filled from the **far pool** first,
      adjacent bleed covering any shortfall. The far pool (`lib/recommendation/far-picks.ts`)
      is the retired Explore page's Uncharted Territory + Curveballs logic, ported into Feed: 4 anchors the
      user hasn't touched (selected genres / listened genres via `artists`) and 4 leaves
      sampled across the genre tree minus the top-2 listened anchors, mid-list (positions
      10+) of each tag, round-robined and capped at 30 names. **Max 8 Last.fm
      `tag.gettopartists` lookups** (+ ≤30 `getInfo` for resolve misses); Curveballs sampled
      34–60 tags. Far names resolve through the same `PlayableCandidates` gate (exclusions +
      underground cap) **in parallel with the primary resolve**, so tier 1 only blocks if the
      far path is slower than the whole primary path, and then for at most
      `FAR_WAIT_BUDGET_MS` (1500 ms); past that the run's bleed is adjacent-only and
      `[gen-timing]` logs `farTimeout=1`. Far picks carry
      `source: 'far_pool'` and `why.outsideUsual = <genre label>` (the card's "Outside your
      usual: <genre>"); adjacent bleed never does. `why` is stored verbatim in
      `recommendation_cache.why` and lifted onto `CardArtist.why.outsideUsual` by
      `assembleFeedCards`. The far and adjacent fetches run concurrently.
    The adjacent bleed's tag fetch + resolve (`fetchAdjacentPool`) starts alongside step 6
    (skipping names the primary/secondary pools already resolve) and is handed in as
    `adjacentPool`. It is read only when the far pool leaves slots open, and the far and
    adjacent waits together stay within `FAR_WAIT_BUDGET_MS` of the bleed-step start; past
    that the run gets no adjacent bleed and `[gen-timing]` logs `bleedTimeout=1`.
    Both pools skip the user's picked and capped seeds (`knownNames`), like the main pool.
    Each pick's **stored score is capped just below the lowest protected top pick** (picks
    keep their own order): the feed lists unseen rows by score, so an uncapped bleed pick
    (fixed relevance + bonus) would display above the top relevance picks.
11. **Hard cluster cap** (`applyClusterCap`, `cluster-cap.ts`) — no genre > **25%** of the
    20-item feed. Runs **after** the bleed merge, since bleed picks often share an adjacent
    tag. See [[genre-system]].
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
    query also skips any `skip_at` row (defense in depth). The returned count is rows **new
    to the feed** (inserts + resurfaced): an already-queued unseen row is still re-written
    (F-C) but not counted, so a build that only re-queues what the user has softens instead
    of reporting success with zero new cards.
14. **Return fast** — the result carries `count`, `pending`, one `finish()` continuation,
    and `metrics`.
15. **Background** (`finish()` via `after()`) — confirm the rest of the primary pool
    (Tier 2, ≤12) then the secondary pool (≤20), writing each batch; then flush every soften
    run's confirm outcomes to `artist_tracks_cache` (even if the secondary pass threw).

## Key modules (`lib/recommendation/`)

| Module | Purpose |
|---|---|
| `engine.ts` | the orchestrator above (seeds, fan-out, scoring, bleed, tiers, `finish()`) |
| `playable-candidates.ts` | the shared name → confirmed-playable pipeline (resolve, `keep` gate, rehydrate, confirm, flush) used by Feed tiers/backfill/bleed and the far pool; `livePlayablePorts(token)` wires Last.fm getInfo, iTunes, Spotify top-tracks |
| `exclusions.ts` | the one "never show this artist" policy (`loadExclusions(supabase, userId, { playThreshold, nameFallback, liked? }, now?)`). Every read is keyset-paged on `id` (`readAllRows`, #175 R8); a mid-read page error keeps the rows read so far (logged) |
| `preview-store.ts` | `PreviewStore`: the ONLY code touching `artist_tracks_cache` — confirm read (`rehydrate`), display read, outcome collector, tracks-route read/refresh/write; one 24h TTL; poisoning guard on tracks-route writes (collector writes satisfy it by construction, #175 E4a) |
| `resolve-candidates.ts` | name → Artist resolver (cache → Last.fm `getInfo` resolve; Spotify-free since #157), 429 backoff |
| `resolve-pools.ts` | blocking (36) / secondary (54) split; latency knobs |
| `confirm-previews.ts` | iTunes-first / Spotify-fallback playability confirm |
| `cluster-cap.ts` | 25% per-genre diversity cap |
| `scoring` (in engine) | `k^popularity` tier multiplier + relevance |
| `window.ts` | weekly-stable seeds: `cacheWindowSeed`, `seededShuffle`, `sampleLikes` |
| `far-picks.ts` | the Wander farther far pool: outside-anchor + leftfield tag pickers, `fetchFarNames` (≤8 tag lookups), `loadListenedGenres` |
| `gen-timing.ts` (+ `lib/metrics/api-call-counter.ts`) | instrumentation (`[gen-timing]` logs; `far=` far fetch wall-clock (so far, on a timeout) and `farWait=` bleed-step start until the far pool was ready or the wait budget ran out (`farTimeout=1`), when Wander farther ran; `bleedTimeout=1` when the adjacent pool missed the same budget) |

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

- **Cost bench:** `BENCH=1 npx vitest run lib/recommendation/engine.bench` drives a whole
  build with the real Last.fm adapter (cache + gate) over 80 ms fake calls and 30 ms fake DB
  queries, and prints live calls / DB round trips / tier-1 wall-clock per scenario. Most
  remaining DB round trips on a cold build are the doorway's per-miss by-name SELECT +
  INSERT; batching them needs a unique index on name-only `artists` rows (D2, #168).

- `FIRST_BATCH_TARGET = 8` is hardcoded; not per-user settable.
- `chain-walker.ts` (speculative multi-hop BFS) was deleted 2026-07-11 — it had zero callers.
- Toggling Wander farther changes the **next batch only**: `adventurous` no longer wipes the
  unseen queue (`lib/taste-change.ts`), and neither does `fameLevel`; only `selectedGenres` does.
- Last.fm tags hyphenated in flipside's tree (e.g. `dutch-black-metal`) may return 0 from
  Last.fm; `lastfm.tagTopArtists` retries with spaces (a second sequential call) — this was
  the old Explore leftfield-rail latency cause, and why the far pool caps tag lookups at 8.
