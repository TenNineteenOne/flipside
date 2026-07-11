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
import { normalizeGenre } from './normalize'

interface GenreData {
  generated: string
  source: string
  nodes: GenreNode[]
}

const data = genreData as GenreData

// ── Indexes (built once at module load) ──────────────────────────────────

interface LeafRecord {
  lastfmTag: string
  normalizedKey: string
  x?: number
  y?: number
  anchorId: string
  clusterId: string
}

const leafByKey = new Map<string, LeafRecord>()
const tagToAnchors = new Map<string, Set<string>>()
const tagToClusters = new Map<string, Set<string>>()
const clusterToLeafKeys = new Map<string, string[]>()
const anchorToClusters = new Map<string, string[]>()
const tagToPrimaryAnchor = new Map<string, string>()

function addMembership(
  tagRaw: string,
  anchorId: string | null,
  clusterId: string | null,
): void {
  const key = normalizeGenre(tagRaw)
  if (!key) return
  if (anchorId) {
    if (!tagToAnchors.has(key)) {
      tagToAnchors.set(key, new Set())
      tagToPrimaryAnchor.set(key, anchorId)
    }
    tagToAnchors.get(key)!.add(anchorId)
  }
  if (clusterId) {
    if (!tagToClusters.has(key)) tagToClusters.set(key, new Set())
    tagToClusters.get(key)!.add(clusterId)
  }
}

// Walk leaves at any depth: v2 adds navigation-only SUBCLUSTER_ nodes that
// push leaves 4+ levels deep inside large clusters.
function collectLeavesDeep(node: GenreNode): GenreNode[] {
  if (!node.children || node.children.length === 0) return [node]
  const out: GenreNode[] = []
  for (const child of node.children) {
    for (const leaf of collectLeavesDeep(child)) out.push(leaf)
  }
  return out
}

for (const anchor of data.nodes) {
  anchorToClusters.set(anchor.id, anchor.children.map((c) => c.id))
  addMembership(anchor.lastfmTag, anchor.id, null)

  for (const cluster of anchor.children) {
    const leafKeys: string[] = []
    // The cluster's own lastfmTag (e.g. "indie") also gets registered as a
    // pseudo-leaf for membership lookups, though it has no coordinates.
    addMembership(cluster.lastfmTag, anchor.id, cluster.id)

    for (const leaf of collectLeavesDeep(cluster)) {
      const key = normalizeGenre(leaf.lastfmTag)
      if (!key) continue
      addMembership(leaf.lastfmTag, anchor.id, cluster.id)
      const rec: LeafRecord = {
        lastfmTag: leaf.lastfmTag,
        normalizedKey: key,
        x: leaf.x,
        y: leaf.y,
        anchorId: anchor.id,
        clusterId: cluster.id,
      }
      // When a normalized key is shared across leaves (rare), first one wins.
      if (!leafByKey.has(key)) leafByKey.set(key, rec)
      leafKeys.push(key)
    }
    clusterToLeafKeys.set(cluster.id, leafKeys)
  }
}

// Flat list of leaves with coordinates, for k-NN scans.
const coordLeaves: LeafRecord[] = []
for (const rec of leafByKey.values()) {
  if (typeof rec.x === 'number' && typeof rec.y === 'number') coordLeaves.push(rec)
}

function anchorsOf(tag: string): Set<string> | null {
  const set = tagToAnchors.get(normalizeGenre(tag))
  return set && set.size > 0 ? set : null
}

function clustersOf(tag: string): Set<string> | null {
  const set = tagToClusters.get(normalizeGenre(tag))
  return set && set.size > 0 ? set : null
}

function euclid(ax: number, ay: number, bx: number, by: number): number {
  return Math.hypot(ax - bx, ay - by)
}

// ── Public API ───────────────────────────────────────────────────────────

/**
 * Primary anchor id for a tag, or null if unknown. Stable across runs.
 */
export function genreToAnchor(tag: string): string | null {
  return tagToPrimaryAnchor.get(normalizeGenre(tag)) ?? null
}

/**
 * Enumerate all anchors in the tree. Used by the Explore "Totally outside"
 * rail to enumerate user-untouched anchors.
 */
export function listAnchors(): Array<{ id: string; label: string; lastfmTag: string }> {
  return data.nodes.map((n) => ({ id: n.id, label: n.label, lastfmTag: n.lastfmTag }))
}

/**
 * Every leaf-tag that belongs to an anchor, flattened. Preserves raw
 * lastfmTag casing (hyphens included) so callers can pass straight to Last.fm.
 */
export function leafTagsInAnchor(anchorId: string): string[] {
  const clusters = anchorToClusters.get(anchorId)
  if (!clusters) return []
  const seen = new Set<string>()
  const out: string[] = []
  for (const cid of clusters) {
    for (const leafKey of clusterToLeafKeys.get(cid) ?? []) {
      if (seen.has(leafKey)) continue
      seen.add(leafKey)
      const leaf = leafByKey.get(leafKey)
      if (leaf) out.push(leaf.lastfmTag)
    }
  }
  return out
}

/**
 * Every leaf across the whole tree, with its anchor id. Used by the
 * Left-field rail to uniformly sample the long tail while honoring the
 * "exclude top 2 anchors" guardrail.
 */
export function allLeavesWithAnchor(): Array<{ lastfmTag: string; anchorId: string }> {
  const out: Array<{ lastfmTag: string; anchorId: string }> = []
  for (const rec of leafByKey.values()) {
    out.push({ lastfmTag: rec.lastfmTag, anchorId: rec.anchorId })
  }
  return out
}


// K-nearest-neighbor sizes. "close" = same-anchor K nearest, "medium" =
// other-anchor K nearest. Tuned to roughly match pre-v2 list sizes.
const K_CLOSE = 15
const K_MEDIUM = 25

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
export function adjacentGenres(tag: string, distance: 'close' | 'medium'): string[] {
  const key = normalizeGenre(tag)
  if (!key) return []

  const rec = leafByKey.get(key)

  if (rec && typeof rec.x === 'number' && typeof rec.y === 'number') {
    const sameAnchor = distance === 'close'
    const k = sameAnchor ? K_CLOSE : K_MEDIUM

    // Score each candidate leaf. We filter by anchor match then sort by dist.
    const scored: { leaf: LeafRecord; d: number }[] = []
    for (const other of coordLeaves) {
      if (other.normalizedKey === key) continue
      const inSameAnchor = other.anchorId === rec.anchorId
      if (sameAnchor !== inSameAnchor) continue
      const d = euclid(rec.x, rec.y, other.x!, other.y!)
      scored.push({ leaf: other, d })
    }
    scored.sort((a, b) => a.d - b.d)
    return scored.slice(0, k).map((s) => s.leaf.lastfmTag)
  }

  // Coord-less fallback — pre-v2 cluster/anchor logic.
  const anchors = anchorsOf(tag)
  if (!anchors) return []
  const clusters = clustersOf(tag)
  const seen = new Set<string>([key])
  const out: string[] = []

  if (distance === 'close') {
    if (!clusters) return []
    for (const cid of clusters) {
      for (const leafKey of clusterToLeafKeys.get(cid) ?? []) {
        if (seen.has(leafKey)) continue
        seen.add(leafKey)
        const leaf = leafByKey.get(leafKey)
        if (leaf) out.push(leaf.lastfmTag)
      }
    }
    return out
  }

  // "medium": leaves in same anchor but NOT shared cluster.
  for (const anchorId of anchors) {
    for (const cid of anchorToClusters.get(anchorId) ?? []) {
      if (clusters && clusters.has(cid)) continue
      for (const leafKey of clusterToLeafKeys.get(cid) ?? []) {
        if (seen.has(leafKey)) continue
        seen.add(leafKey)
        const leaf = leafByKey.get(leafKey)
        if (leaf) out.push(leaf.lastfmTag)
      }
    }
  }
  return out
}
