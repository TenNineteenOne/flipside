---
title: Genre System
updated: 2026-06-06
related: [[generation-engine]], [[explore-engine]], [[settings-and-discovery]], [[infra-and-ops]]
---

# Genre System

flipside's genre taxonomy drives seeds, adjacency bleed, the cluster cap, and the Explore
leftfield rail. Tree in `data/genres.json`; logic in `lib/genre/`.

## The tree (4 levels)

`data/genres.json` — **Anchor → Cluster → Subcluster → Leaf**:

- **Anchor** (12): broad families (Rock, Metal, Pop, Electronic, Hip-Hop, R&B/Soul,
  Jazz/Blues, Classical/Orchestral, Folk/Country/Americana, World/Regional, Experimental,
  Religious/Spiritual). ID prefix `ANCHOR_`.
- **Cluster** (~80): mid-level groupings. `CLUSTER_`.
- **Subcluster**: navigation-only buckets for large clusters (>30 leaves), split by keyword
  dictionary; no `lastfmTag`. `SUBCLUSTER_`.
- **Leaf** (~6,291): individual genres with `lastfmTag` and everynoise.com 2D sonic-map
  coords (`x`,`y`), `color`, `fontSize`, `exemplar`. ID prefix `sp:`.

Header source string:
`everynoise+hierarchy-fitted-2026-04-21+subclustered + validated-lastfm@0.75`.

## Normalization (`lib/genre/normalize.ts`)

`normalizeGenre(raw)` → lowercase, collapse hyphens/underscores/spaces to a single space,
trim. Reconciles the three input forms — Spotify `"Indie Rock"`, Last.fm `"indie-rock"`,
stored `lastfmTag`. Raw values are never mutated.

## Adjacency (`lib/genre/adjacency.ts`)

Builds five in-memory indexes at module load (`leafByKey`, `tagToAnchors`, `tagToClusters`,
`clusterToLeafKeys`, `anchorToClusters`).

- **`adjacencyScore(a,b)`** ∈ [0,1]: 1.0 same tag; continuous
  `1 − euclideanDistance/diagonal` when both have coords; tiered fallback otherwise
  (0.7 same cluster, 0.4 same anchor, 0.1 known, 0 unknown).
- **`adjacentGenres(tag, 'close'|'medium')`** k-NN: `close` = 15 nearest in the **same**
  anchor; `medium` = 25 nearest in **other** anchors. Coord-less tags fall back to
  cluster/anchor siblings.
- Also: `genreToAnchor`, `listAnchors`, `leafTagsInAnchor`, `allLeavesWithAnchor`
  (the leftfield-rail source — see [[explore-engine]]).

Used by `augmentWithAdjacent` (Feed bleed), `outsideRail`/`leftfieldRail` (Explore), and
`primaryGenreOf` for the cluster cap (see [[generation-engine]]).

## Build & maintenance scripts (`scripts/`)

| Script | Purpose |
|---|---|
| `build-genre-taxonomy.ts` | original Wikidata SPARQL → 12×80 skeleton |
| `build-genres-v2.ts` | slot 6,291 everynoise leaves; add x/y/color |
| `build-subclusters.ts` | split clusters >30 leaves by keyword dict (idempotent) |
| `validate-genre-tree.ts` | Last.fm `tag.getSimilar` validation; `--apply` auto-moves leaves ≥0.75 confidence |
| `subcluster-keywords.ts` | the keyword dictionary |
| `seed-artist-cache.ts` | populate `artist_search_cache` from Last.fm tag top artists → Spotify-resolve |
| `backfill-artist-genres.ts` | fill genres+popularity via MusicBrainz + Last.fm (avoids Spotify quota) |
| `mb-coverage-spike.ts` | one-off MusicBrainz genre-coverage research (not production) |
| `inspect-cache.ts` | post-backfill verification |

All long scripts checkpoint to `.checkpoint.json` for safe resume.

> Note: `backfill-artist-genres.ts` already uses **MusicBrainz + Last.fm** (not Spotify) to
> fill genres/popularity — evidence the genre data is largely Spotify-independent. See
> [[spotify-dependency]].
