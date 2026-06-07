---
title: Explore Engine (Rails)
updated: 2026-06-06
related: [[generation-engine]], [[music-providers]], [[genre-system]], [[api-routes]]
---

# Explore Engine (Rails)

The `/explore` screen's four themed rails. Entry point: `buildExploreRails(input, opts)` in
`lib/recommendation/explore-engine.ts` (~47KB). Reuses the resolver/confirm core from
[[generation-engine]] (`resolveAndFilter` = resolve + filter + confirm). Caches per-rail in
`explore_cache` (24h TTL — see [[data-model]]).

## Cache behavior

- `regenerate: false` returns partial cache **without** triggering a build (the fast-paint
  read path used by the page and `GET /api/explore/rails`).
- `force=true` (via `POST /api/explore/generate`) rebuilds in the background; the client
  poll-swaps when `generatedAt` advances. See [[api-routes]] and [[pages-and-components]].

## The four rails (`Promise.allSettled`, one failing never blocks others)

| Rail | UI title | How candidates are chosen |
|---|---|---|
| `adjacentRail` | **After Hours** | stable 6-tag rotation from `AFTERHOURS_TAGS` (mood tags) via `cacheWindowSeed`; `tag.gettopartists` per tag |
| `outsideRail` | **Uncharted Territory** | genre anchors the user *hasn't* touched; Last.fm top-40 per anchor, sliced positions 10–40 (skip mainstream) |
| `wildcardsRail` | **Rabbit Holes** | 3–4 thumbs-up seeds → `getSimilarArtistNames`, tail-biased (low match-score first); falls back to most-played; empty when cold |
| `leftfieldRail` | **Curveballs** | `allLeavesWithAnchor()` across the whole [[genre-system]] tree, excluding the user's top-2 anchors; seeded-shuffle, sample 34–60 tags, mid-list per tag |

`leftfieldRail` resolves the first 48–80 names on the critical path and fires a
**background** warm-resolve of the next ~40 (non-blocking, only on the primary
`seedKey='leftfield'` pass to avoid request storms).

When the user has zero thumbs-ups, the wildcards rail is replaced by a second leftfield run
(`seedKey='wildcards-fallback'`, excluding the primary leftfield picks).

## Post-processing

1. **Cross-rail cluster cap** (`applyCrossRailClusterCap`) — no genre > 25% across all
   rails; swaps stay *within* a rail to preserve its theme. See [[genre-system]].
2. **Cross-rail dedup** — first-rail occurrence wins.
3. **Minimum-floor topup** — rails below 5 artists topped up via extra `leftfieldRail`
   runs with distinct seed keys.
4. **Cache write** — upsert all four rails.
5. **Underground cap** (`enforceUndergroundCap`) — post-hydration belt-and-braces drop of
   `popularity > 50` when underground mode is on.

## Payload assembly

`explore-rail-payloads.ts` is the single source of truth for rail titles/subtitles/empty
captions and wildcards-fallback detection. `assembleRailPayloads(rails, artistById)` →
`RailPayload[]` for the client. Legacy rows with `topTracks=undefined` pass the playability
guard; `topTracks=[]` (negative cache) rows are dropped.

## Weekly stability

Rail picks are stable within a 7-day window (`cacheWindowSeed` = FNV-1a of
`userId:seedKey:weekNumber`) and rotate on the weekly boundary, not on TTL hit. Feed and
Explore share the same like-sample so they feel coherent. See `window.ts` in
[[generation-engine]].
