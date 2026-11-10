/**
 * Genre adjacency graph built from data/genres.json v2.
 *
 * v2 changes: each leaf carries everynoise.com 2D sonic-map coordinates
 * (x ≈ mechanical↔organic, y ≈ dense↔spiky). adjacentGenres returns the K
 * nearest leaves in the same anchor (close) or the K nearest in OTHER
 * anchors (medium).
 *
 * Fallback: tags that lack coords (anchor/cluster tags, or leaves from the
 * pre-v2 Wikidata tree that didn't get everynoise matches) use the old
 * cluster/anchor tiered logic so existing users' selected_genres continue
 * to work.
 *
 * All lookups use the normalized form (see lib/genre/normalize.ts) so
 * Spotify's "Indie Rock", Last.fm's "indie-rock", and stored "indie_rock"
 * all resolve identically.
 */

import genreData from '@/data/genres.json'
import type { GenreNode } from '@/lib/types'
import { createGenreGraph } from './genre-graph'

interface GenreData {
  generated: string
  source: string
  nodes: GenreNode[]
}

const graph = createGenreGraph((genreData as GenreData).nodes)

/**
 * Primary anchor id for a tag, or null if unknown. Stable across runs.
 */
export const genreToAnchor = graph.genreToAnchor

/**
 * Enumerate all anchors in the tree. Used by the Explore "Totally outside"
 * rail to enumerate user-untouched anchors.
 */
export const listAnchors = graph.listAnchors

/**
 * Every leaf-tag that belongs to an anchor, flattened. Preserves raw
 * lastfmTag casing (hyphens included) so callers can pass straight to Last.fm.
 */
export const leafTagsInAnchor = graph.leafTagsInAnchor

/**
 * Every leaf across the whole tree, with its anchor id. Used by the
 * Left-field rail to uniformly sample the long tail while honoring the
 * "exclude top 2 anchors" guardrail.
 */
export const allLeavesWithAnchor = graph.allLeavesWithAnchor

/**
 * Return lastfmTag strings adjacent to `tag` at the requested distance band.
 *
 *   "close"  — K nearest leaves (by x/y) that share an anchor with `tag`.
 *              Falls back to cluster-sibling listing when `tag` has no coords.
 *   "medium" — K nearest leaves in OTHER anchors (for discovery bleed).
 *              Falls back to anchor-cousin listing when `tag` has no coords.
 *
 * The input tag itself is never included. Returns original lastfmTag
 * strings (preserving hyphens) so callers can pass them straight to
 * Last.fm API calls.
 */
export const adjacentGenres = graph.adjacentGenres
