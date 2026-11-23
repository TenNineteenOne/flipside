---
title: Genre System
updated: 2026-11-22
related: [[generation-engine]], [[settings-and-discovery]], [[infra-and-ops]]
---

# Genre System

flipside's genre taxonomy drives seeds, adjacency bleed, the cluster cap, and the far
pool (always-on Wander farther). Tree in `data/genres.json`; logic in `lib/genre/`.

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

The logic is a pure factory, `createGenreGraph(nodes)` (`lib/genre/genre-graph.ts`), which builds
five in-memory indexes (`leafByKey`, `tagToAnchors`, `tagToClusters`, `clusterToLeafKeys`,
`anchorToClusters`). `adjacency.ts` binds it once, for server code, to the slim
**`data/genres-picker.json`** (decoded with `decodePickerTree`), so server bundles do not load
the full `data/genres.json`; only scripts and `picker-data.test.ts` read that file now.
The client genre picker (onboarding + Settings) binds it to the same slim file: the same tree with only `id`, `label`, `lastfmTag`, `children` and leaf `x`/`y`
(`slimGenreTree`, `lib/genre/picker-data.ts`), stored in a compact lossless encoding
(`encodePickerTree` / `decodePickerTree`, same file): `{ t, x, y }`, where a leaf whose id is
`sp:` + its tag is just the tag (or `[tag, label]` when the label is not the tag with `-` as
spaces), every other node is `[id, label, lastfmTag, children]`, and leaf coordinates sit in the
`x` / `y` arrays in depth-first order. 210 kB raw, ~66 kB gzip (was 765 kB / 132 kB as plain
objects; the full tree is 3.3 MB). The picker module decodes it once at import; only the lazily
loaded picker chunk carries it. Regenerate it with `npm run build:genres-picker` whenever
`genres.json` changes; `lib/genre/picker-data.test.ts` fails while they differ and checks the
round trip, the picker data and adjacency against the full tree.

- `adjacencyScore(a,b)` was deleted 2026-07-11 — it had no production callers. The
  pairwise-scoring implementation (continuous distance + tiered fallback) lives in git
  history if ever needed again.
- **`adjacentGenres(tag, 'close'|'medium')`** k-NN: `close` = 15 nearest in the **same**
  anchor; `medium` = 25 nearest in **other** anchors. Coord-less tags fall back to
  cluster/anchor siblings.
- Also: `genreToAnchor`, `listAnchors`, `leafTagsInAnchor`, `allLeavesWithAnchor`
  (the far pool's leftfield source — `lib/recommendation/far-picks.ts`).

Used by `augmentWithAdjacent` (Feed bleed), the far pool's outside-anchor and leftfield
pickers (`far-picks.ts`); the cluster cap keys on `genres[0]` (see [[generation-engine]]).

## Build & maintenance scripts (`scripts/`)

| Script | Purpose |
|---|---|
| `build-subclusters.ts` | split clusters >30 leaves by keyword dict (idempotent) |
| `build-genres-picker.ts` | write the slim `data/genres-picker.json` the client genre picker ships (rerun after any change to `data/genres.json`) |
| `validate-genre-tree.ts` | Last.fm `tag.getSimilar` validation; `--apply` auto-moves leaves ≥0.75 confidence |
| `subcluster-keywords.ts` | the keyword dictionary |
| `seed-artist-cache.ts` | seed the `artists` table: Last.fm tag top artists for every leaf, then Spotify search through the identity doorway (names already in `artists` skip Spotify) |
| `backfill-artist-genres.ts` | fill-only genres+popularity on `artists` (+ `recommendation_cache.artist_data`) via MusicBrainz + Last.fm (avoids Spotify quota) |

The two one-off scripts that first built `data/genres.json` (`build-genre-taxonomy.ts`,
`build-genres-v2.ts`) were deleted on 2026-11-22; they are in git history. `data/genres.json`
is now the source of truth and is edited through the scripts above.

All long scripts checkpoint to `.checkpoint.json` for safe resume.

> Note: `backfill-artist-genres.ts` already uses **MusicBrainz + Last.fm** (not Spotify) to
> fill genres/popularity — evidence the genre data is largely Spotify-independent. See
> [[spotify-dependency]].
