/**
 * The Feed's far pool (#205 "Wander farther"): candidate NAMES from genre
 * territory the user hasn't touched. Ported from Explore's two discovery
 * rails, which are deleted with Explore:
 *   - outside   (was `outsideRail`, "Uncharted Territory"): anchors the user
 *     has never touched (else least-touched), mid-list of each anchor's tag.
 *   - leftfield (was `leftfieldRail`, "Curveballs"): leaves sampled across the
 *     whole genre tree minus the user's top-2 listened anchors, mid-list.
 *
 * Names only: the engine resolves them through the same PlayableCandidates
 * pipeline (exclusions, underground cap, rehydrate, confirm) as every other
 * Feed pick. Last.fm cost is capped at FAR_TAG_CALLS tag lookups (Curveballs
 * sampled 34–60 tags; that was Explore's slowest build).
 */
import { allLeavesWithAnchor, genreToAnchor, leafTagsInAnchor, listAnchors } from '@/lib/genre/adjacency'
import type { createServiceClient } from '@/lib/supabase/server'
import { readAllRows } from './exclusions'
import { seededShuffle } from './window'

type SupabaseClient = ReturnType<typeof createServiceClient>

/** A far candidate and the genre label its card shows ("Outside your usual: <label>"). */
export interface FarName {
  name: string
  label: string
}

export interface ListenedGenres {
  play_count: number
  genres: string[]
}

const OUTSIDE_ANCHORS = 4
const OUTSIDE_MID_START = 10 // skip the mainstream head of the tag's top list
const OUTSIDE_MID_END = 40
const OUTSIDE_PER_ANCHOR = 6
const LEFTFIELD_TAGS = 4
const LEFTFIELD_MID_START = 10
const LEFTFIELD_MID_END = 30
const LEFTFIELD_PER_TAG = 8
/** Max Last.fm tag.gettopartists lookups per far fetch (each may retry once with spaces). */
export const FAR_TAG_CALLS = OUTSIDE_ANCHORS + LEFTFIELD_TAGS
/** Max far names handed to the resolver (each cache miss is one Last.fm getInfo). */
export const FAR_RESOLVE_CAP = 30

/**
 * The user's top 2 anchors by listened play_count; [] when fewer than 2
 * anchors have data (the leftfield guardrail is then skipped).
 */
export function computeTopAnchors(listened: ListenedGenres[]): string[] {
  const anchorPlays = new Map<string, number>()
  for (const row of listened) {
    const anchor = row.genres[0] ? genreToAnchor(row.genres[0]) : null
    if (!anchor) continue
    anchorPlays.set(anchor, (anchorPlays.get(anchor) ?? 0) + (row.play_count ?? 0))
  }
  if (anchorPlays.size < 2) return []
  return [...anchorPlays.entries()].sort((a, b) => b[1] - a[1]).slice(0, 2).map(([a]) => a)
}

function hashString(s: string): number {
  let h = 2166136261 >>> 0
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619) >>> 0
  }
  return h
}

/** Seeded start index within a slice of `len`. `>>> 0` keeps it non-negative for seeds past Int32. */
export function midListStart(seed: number, tag: string, len: number): number {
  return ((seed ^ hashString(tag)) >>> 0) % len
}

/** Anchors the user hasn't touched (selected genres weigh 100, plays by count); least-touched when all are. */
export function outsideTags(selectedGenres: string[], listened: ListenedGenres[], seed: number): Array<{ tag: string; label: string }> {
  const touched = new Map<string, number>()
  for (const g of selectedGenres) {
    const anchor = genreToAnchor(g)
    if (anchor) touched.set(anchor, (touched.get(anchor) ?? 0) + 100)
  }
  for (const row of listened) {
    const anchor = row.genres[0] ? genreToAnchor(row.genres[0]) : null
    if (anchor) touched.set(anchor, (touched.get(anchor) ?? 0) + (row.play_count ?? 1))
  }
  const anchors = listAnchors()
  const untouched = anchors.filter((a) => !touched.has(a.id))
  const picked = untouched.length >= OUTSIDE_ANCHORS
    ? seededShuffle(untouched, seed).slice(0, OUTSIDE_ANCHORS)
    : [...anchors].sort((a, b) => (touched.get(a.id) ?? 0) - (touched.get(b.id) ?? 0)).slice(0, OUTSIDE_ANCHORS)
  return picked
    .map((a) => ({ tag: a.lastfmTag || leafTagsInAnchor(a.id)[0], label: a.label }))
    .filter((t) => !!t.tag)
}

/** Leaves sampled across the genre tree, minus the user's top-2 listened anchors. */
export function leftfieldTags(listened: ListenedGenres[], seed: number): Array<{ tag: string; label: string }> {
  const excluded = new Set(computeTopAnchors(listened))
  const pool = allLeavesWithAnchor().filter((l) => !excluded.has(l.anchorId))
  return seededShuffle(pool, seed)
    .slice(0, LEFTFIELD_TAGS)
    .map((l) => ({ tag: l.lastfmTag, label: l.lastfmTag.replace(/-/g, ' ') }))
}

/**
 * Fetch the far pool: all FAR_TAG_CALLS tag lookups in parallel, then a
 * round-robin across tags (the k-th name of every tag before any k+1-th) so no
 * tag floods the pool, deduped and capped at FAR_RESOLVE_CAP. Never throws: a
 * failed tag contributes nothing. `seed` varies the picks per batch.
 */
export async function fetchFarNames(input: {
  selectedGenres: string[]
  listened: ListenedGenres[]
  seed: number
  fetchTagArtists: (tag: string, limit: number) => Promise<string[]>
}): Promise<FarName[]> {
  const { selectedGenres, listened, seed, fetchTagArtists } = input
  const safe = (tag: string, limit: number) => fetchTagArtists(tag, limit).catch(() => [] as string[])

  const outside = outsideTags(selectedGenres, listened, seed).map(async ({ tag, label }) => ({
    label,
    names: (await safe(tag, OUTSIDE_MID_END)).slice(OUTSIDE_MID_START, OUTSIDE_MID_END).slice(0, OUTSIDE_PER_ANCHOR),
  }))
  const leftfield = leftfieldTags(listened, seed).map(async ({ tag, label }) => {
    const names = await safe(tag, LEFTFIELD_MID_END)
    // Niche tags often have <10 artists: fall back to the whole list.
    const mid = names.slice(LEFTFIELD_MID_START, LEFTFIELD_MID_END)
    const slice = mid.length > 0 ? mid : names
    if (slice.length === 0) return { label, names: [] }
    const start = midListStart(seed, tag, slice.length)
    const picks = new Set<string>()
    for (let k = 0; k < Math.min(LEFTFIELD_PER_TAG, slice.length); k++) picks.add(slice[(start + k) % slice.length])
    return { label, names: [...picks] }
  })
  const lists = await Promise.all([...outside, ...leftfield])

  const out: FarName[] = []
  const seen = new Set<string>()
  const maxLen = Math.max(0, ...lists.map((l) => l.names.length))
  for (let k = 0; k < maxLen && out.length < FAR_RESOLVE_CAP; k++) {
    for (const { label, names } of lists) {
      const name = names[k]
      if (!name || seen.has(name.toLowerCase())) continue
      seen.add(name.toLowerCase())
      out.push({ name, label })
      if (out.length >= FAR_RESOLVE_CAP) break
    }
  }
  return out
}

/**
 * Listened artists with their genres (via the `artists` roster), for the
 * touched-anchor and top-anchor guardrails. A failed read degrades to the
 * rows read so far (readAllRows logs it).
 */
export async function loadListenedGenres(supabase: SupabaseClient, userId: string): Promise<ListenedGenres[]> {
  type Genres = { genres: string[] | null }
  // Many-to-one embeds come back as an object; the untyped client infers an array.
  const { data } = await readAllRows<{ id: string; play_count: number | null; artists: Genres | Genres[] | null }>(() =>
    supabase
      .from('listened_artists')
      .select('id, play_count, artists(genres)')
      .eq('user_id', userId)
      .not('artist_id', 'is', null),
  )
  return data.map((r) => {
    const a = Array.isArray(r.artists) ? r.artists[0] : r.artists
    return { play_count: r.play_count ?? 0, genres: a?.genres ?? [] }
  })
}
