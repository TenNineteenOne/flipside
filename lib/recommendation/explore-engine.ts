/**
 * Explore engine — generates the four themed rails on /explore.
 *
 * Each rail is an isolated async function; `buildExploreRails` fans them out
 * in parallel. Rails write `explore_cache` rows (one per user per rail_key)
 * with a 24h TTL. Cached empty rails stay cached to prevent re-fetch thrash.
 *
 * Unlike the For You pipeline, rails do NOT write to `recommendation_cache`
 * on generation — but when a user acts on a rail card (thumbs-up, thumbs-down,
 * skip), the feedback path upserts into `recommendation_cache` so the 7-day
 * `seen_at` cooldown applies globally across both tabs.
 */

import { musicProvider } from '@/lib/music-provider/provider'
import type { Artist } from '@/lib/music-provider/types'
import { createServiceClient } from '@/lib/supabase/server'
import { ArtistNameCache } from './artist-name-cache'
import { resolveArtistsByName } from './resolve-candidates'
import { fetchArtistEnrichment } from './enrich-artist'
import { getTagArtistNames } from './engine'
import {
  allLeavesWithAnchor,
  genreToAnchor,
  leafTagsInAnchor,
  listAnchors,
} from '@/lib/genre/adjacency'
import { UNDERGROUND_MAX_POPULARITY } from './types'

export const RAIL_KEYS = ['adjacent', 'outside', 'wildcards', 'leftfield'] as const
export type RailKey = typeof RAIL_KEYS[number]

export const EXPLORE_CACHE_TTL_MS = 24 * 60 * 60 * 1000

export interface RailWhy {
  /** Why a given artist landed in this rail. Populated when useful (wildcards only in P2.1). */
  sourceArtist?: string
  sourceArtistId?: string
  chain?: Array<{ name: string; match: number }> | null
  tag?: string
  anchor?: string
  /**
   * Marker stored at the reserved `__meta` key in the why map when this rail
   * was substituted by a fallback generator. Lets the page re-title the slot
   * without adding a new column.
   */
  fallbackKind?: 'leftfield-for-wildcards'
}

/** Reserved non-artist key inside RailResult.why to carry meta about the rail. */
export const RAIL_META_KEY = '__meta'

export interface RailResult {
  railKey: RailKey
  artistIds: string[]
  why: Record<string, RailWhy>
}

export interface BuildRailsInput {
  userId: string
  accessToken: string
  adventurous: boolean
  undergroundMode?: boolean
  /**
   * k in [0.90, 1.00] from users.popularity_curve. Used to rank rail
   * candidates by k^popularity (lower pop scores higher when k < 1). Left-
   * field rail intentionally ignores this — its identity is uniform sampling.
   */
  popularityCurve?: number
  /**
   * users.play_threshold. Threaded through for future use; Explore today
   * excludes all listened artists regardless, so it's a no-op in rails.
   */
  playThreshold?: number
}

type SupabaseClient = ReturnType<typeof createServiceClient>

// ── Shared helpers ──────────────────────────────────────────────────────────

function buildEnrichArtist() {
  const apiKey = process.env.LASTFM_API_KEY
  if (!apiKey) return undefined
  return (name: string) => fetchArtistEnrichment(name, apiKey)
}

/**
 * Deterministic cache-window hash. Keeps rail picks stable within the TTL so
 * a re-fetch during the same cache window doesn't shuffle results under the
 * user's feet (and can't be exploited to game uniqueness).
 */
export function cacheWindowSeed(userId: string, seedKey: string): number {
  const weekStart = Math.floor(Date.now() / (7 * 24 * 60 * 60 * 1000))
  let h = 2166136261 >>> 0
  const s = `${userId}:${seedKey}:${weekStart}`
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619) >>> 0
  }
  return h
}

/**
 * Stable shuffle using the cache-window seed so the same user + same rail
 * produces the same order within a 7-day window.
 */
export function seededShuffle<T>(arr: T[], seed: number): T[] {
  const out = [...arr]
  let s = seed || 1
  for (let i = out.length - 1; i > 0; i--) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    const j = s % (i + 1)
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

/**
 * Re-rank a candidate-name list by k^popularity so lower-popularity picks
 * win when the user's `popularity_curve` < 1. Stable: ties preserve the
 * caller's original order (round-robin breadth). No-op when k is undefined
 * or ≥ 1.0 (mainstream / default — preserves today's character).
 */
export function rankByCurve(
  names: string[],
  byName: Map<string, { popularity?: number }>,
  k: number | undefined,
): string[] {
  if (!k || k >= 1.0) return names
  const scored = names.map((n, i) => {
    const a = byName.get(n)
    const pop = a?.popularity ?? 50
    return { n, i, score: Math.pow(k, pop) }
  })
  scored.sort((a, b) => b.score - a.score || a.i - b.i)
  return scored.map((s) => s.n)
}

async function loadUserContext(supabase: SupabaseClient, userId: string) {
  const [{ data: user }, { data: seedArtists }, { data: listenedRows }, { data: thumbsUp }, { data: thumbsDown }] = await Promise.all([
    supabase.from('users').select('id, selected_genres, adventurous').eq('id', userId).maybeSingle(),
    supabase.from('seed_artists').select('spotify_artist_id, name').eq('user_id', userId),
    supabase.from('listened_artists').select('spotify_artist_id, play_count').eq('user_id', userId).not('spotify_artist_id', 'is', null),
    supabase.from('feedback').select('spotify_artist_id').eq('user_id', userId).eq('signal', 'thumbs_up').is('deleted_at', null),
    supabase.from('feedback').select('spotify_artist_id').eq('user_id', userId).eq('signal', 'thumbs_down').is('deleted_at', null),
  ])

  // Hydrate listened artists with their genres via artist_search_cache.
  // Chunked at 200 to stay within Postgres IN-list limits; chunks run in
  // parallel so a user with 1000+ listened artists pays one round-trip of
  // latency instead of N.
  const listenedIds = (listenedRows ?? []).map((r) => r.spotify_artist_id as string)
  const genreById = new Map<string, string[]>()
  const CHUNK = 200
  const chunks: string[][] = []
  for (let i = 0; i < listenedIds.length; i += CHUNK) {
    chunks.push(listenedIds.slice(i, i + CHUNK))
  }
  const chunkResults = await Promise.all(
    chunks.map((chunk) =>
      supabase
        .from('artist_search_cache')
        .select('spotify_artist_id, artist_data')
        .in('spotify_artist_id', chunk),
    ),
  )
  for (const { data } of chunkResults) {
    for (const row of data ?? []) {
      const artist = row.artist_data as { genres?: string[] } | null
      genreById.set(row.spotify_artist_id as string, artist?.genres ?? [])
    }
  }

  const listened = (listenedRows ?? []).map((r) => ({
    spotify_artist_id: r.spotify_artist_id as string,
    play_count: (r.play_count as number) ?? 0,
    genres: genreById.get(r.spotify_artist_id as string) ?? [],
  }))

  return {
    user,
    selectedGenres: ((user?.selected_genres ?? []) as string[]),
    seedArtists: (seedArtists ?? []) as Array<{ spotify_artist_id: string; name: string }>,
    listened,
    listenedIds: new Set(listenedIds),
    thumbsUpIds: new Set((thumbsUp ?? []).map((r) => r.spotify_artist_id as string)),
    thumbsDownIds: new Set((thumbsDown ?? []).map((r) => r.spotify_artist_id as string)),
  }
}

/**
 * Compute the user's top 2 anchors by total listened play_count. Used by the
 * Left-field rail to exclude their most-played territory so picks actually
 * feel outside. Returns [] when fewer than 2 anchors have any data (skip the
 * guardrail — fall back to truly wild).
 */
export function computeTopAnchors(
  listened: Array<{ play_count: number; genres: string[] }>
): string[] {
  const anchorPlays = new Map<string, number>()
  for (const row of listened) {
    const primary = row.genres[0]
    if (!primary) continue
    const anchor = genreToAnchor(primary)
    if (!anchor) continue
    anchorPlays.set(anchor, (anchorPlays.get(anchor) ?? 0) + (row.play_count ?? 0))
  }
  if (anchorPlays.size < 2) return []
  return [...anchorPlays.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2)
    .map(([anchor]) => anchor)
}

/**
 * Resolve a flat list of Last.fm artist names to Spotify Artists + cache them.
 * Honors the same listened/thumbs-down/seen filters the main engine uses so
 * rails stay consistent with For You.
 */
async function resolveAndFilter(
  names: string[],
  accessToken: string,
  supabase: SupabaseClient,
  filters: {
    listenedIds: Set<string>
    thumbsDownIds: Set<string>
    seenIds: Set<string>
    undergroundMode?: boolean
  },
): Promise<Artist[]> {
  const unique = [...new Set(names.filter(Boolean))]
  if (unique.length === 0) return []
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const nameCache = new ArtistNameCache(supabase as any)
  const resolved = await resolveArtistsByName(unique, {
    cache: nameCache,
    searchArtists: (name) => musicProvider.searchArtists(accessToken, name),
    enrichArtist: buildEnrichArtist(),
  })

  const out: Artist[] = []
  for (const artist of resolved.resolved.values()) {
    if (filters.listenedIds.has(artist.id)) continue
    if (filters.thumbsDownIds.has(artist.id)) continue
    if (filters.seenIds.has(artist.id)) continue
    if (filters.undergroundMode && (artist.popularity ?? 0) > UNDERGROUND_MAX_POPULARITY) continue
    out.push(artist)
  }
  return out
}

async function loadSeenIds(supabase: SupabaseClient, userId: string): Promise<Set<string>> {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
  const { data } = await supabase
    .from('recommendation_cache')
    .select('spotify_artist_id, seen_at')
    .eq('user_id', userId)
    .not('seen_at', 'is', null)
    .gte('seen_at', sevenDaysAgo)
  return new Set((data ?? []).map((r) => r.spotify_artist_id as string))
}

// ── Rail implementations ────────────────────────────────────────────────────
//
// Each rail is implemented in its own issue:
//   #102 P2.2a — adjacentRail
//   #103 P2.2b — outsideRail
//   #104 P2.2c — wildcardsRail
//   #105 P2.2d — leftfieldRail
//
// P2.1 (this commit) wires the framework: all rails currently return empty
// results so the UI can render shells + empty states, and the cache round-trip
// can be verified end-to-end.

const AFTERHOURS_TARGET = 10
const AFTERHOURS_TARGET_ADVENTUROUS = 12
// Larger pool to keep the rail robust for users with thin signal state: mood
// tags often return only 2-4 artists on Last.fm, and listened/seen filters
// drop more. 10 tags × 6 per tag = 60 theoretical candidates — enough that the
// rail reliably clears the MIN_PICKS=5 floor after attrition.
const AFTERHOURS_PER_TAG = 6
const AFTERHOURS_PICK_COUNT = 10

// Mood tags for the After Hours rail — late-night / ambient / atmospheric.
// Rotated per user per week so pickups feel fresh without thrashing. Broad
// tags like "ambient" and "downtempo" are intentionally excluded — Last.fm
// users apply them too liberally (classical, film score, mainstream EDM all
// leak in), so we stick to narrower, mood-cohesive tags.
const AFTERHOURS_TAGS = [
  'dream pop', 'shoegaze', 'slowcore', 'drone', 'dark ambient',
  'ethereal wave', 'chillwave', 'post-rock', 'trip hop', 'sadcore',
  'cold wave', 'dungeon synth', 'gothic rock', 'dreamgaze', 'ambient black metal',
] as const

/**
 * After Hours rail — ambient / late-night / atmospheric picks, independent of
 * the user's stated taste so it reads as an editorial mood shelf rather than
 * "more of what you already have." Pulls a rotating 6-tag subset per user per
 * week, fetches top artists per tag, round-robins for breadth, filters out
 * already-known / thumbs-down / already-seen artists.
 */
export async function adjacentRail(
  input: BuildRailsInput,
  ctx: Awaited<ReturnType<typeof loadUserContext>>,
  supabase: SupabaseClient,
  seenIds: Set<string>,
): Promise<RailResult> {
  const target = input.adventurous ? AFTERHOURS_TARGET_ADVENTUROUS : AFTERHOURS_TARGET
  const perTag = AFTERHOURS_PER_TAG

  // Stable 6-tag rotation — same week + same user = same seed tags.
  const startIdx = cacheWindowSeed(input.userId, 'afterhours') % AFTERHOURS_TAGS.length
  const chosenTags: string[] = []
  for (let i = 0; i < AFTERHOURS_PICK_COUNT; i++) {
    chosenTags.push(AFTERHOURS_TAGS[(startIdx + i) % AFTERHOURS_TAGS.length])
  }

  const perTagResults = await Promise.all(
    chosenTags.map((tag) => getTagArtistNames(tag, perTag + 2)),
  )
  const tagToNames = new Map<string, string[]>()
  for (let i = 0; i < chosenTags.length; i++) {
    tagToNames.set(chosenTags[i], perTagResults[i].slice(0, perTag + 2))
  }

  // Round-robin across tags → name list + name→tag map for provenance.
  const nameToTag = new Map<string, string>()
  const namesRoundRobin: string[] = []
  let exhausted = false
  let idx = 0
  while (!exhausted) {
    exhausted = true
    for (const tag of chosenTags) {
      const list = tagToNames.get(tag)!
      if (idx < list.length) {
        exhausted = false
        const name = list[idx]
        if (!nameToTag.has(name)) {
          nameToTag.set(name, tag)
          namesRoundRobin.push(name)
        }
      }
    }
    idx++
  }

  const resolved = await resolveAndFilter(namesRoundRobin, input.accessToken, supabase, {
    listenedIds: ctx.listenedIds,
    thumbsDownIds: ctx.thumbsDownIds,
    seenIds,
    undergroundMode: input.undergroundMode,
  })

  const artistByName = new Map<string, Artist>()
  for (const a of resolved) artistByName.set(a.name, a)

  const ranked = rankByCurve(namesRoundRobin, artistByName, input.popularityCurve)

  const artistIds: string[] = []
  const why: Record<string, RailWhy> = {}
  const seen = new Set<string>()
  for (const name of ranked) {
    if (artistIds.length >= target) break
    const a = artistByName.get(name)
    if (!a || seen.has(a.id)) continue
    seen.add(a.id)
    artistIds.push(a.id)
    const tag = nameToTag.get(name)
    why[a.id] = tag ? { tag, anchor: genreToAnchor(tag) ?? undefined } : {}
  }

  return { railKey: 'adjacent', artistIds, why }
}

const OUTSIDE_TARGET = 10
const OUTSIDE_TARGET_ADVENTUROUS = 12
// Pick more anchors so niche anchors with thin Last.fm results don't starve the
// rail. The per-anchor target (6) + mid-list slice still preserve the rail's
// "uncharted" identity — each anchor is genuinely a corner the user hasn't
// explored; we just sample more of them.
const OUTSIDE_ANCHORS_PICKED = 5
const OUTSIDE_ANCHORS_PICKED_ADVENTUROUS = 6
const OUTSIDE_MID_START = 10 // slice start of Last.fm top artists — skip mainstream head
const OUTSIDE_MID_END = 40   // exclusive slice end
const OUTSIDE_PER_ANCHOR_TARGET = 6

/**
 * Totally outside your taste — pull mid-list artists from anchors the user
 * has never touched. "Mid-list" = Last.fm top artists for a tag, slice 10-30,
 * so we avoid the mainstream head but still have non-trivial signal.
 *
 * When every anchor has been touched (maxed-out listener), fall back to the
 * least-touched anchors instead so the rail never goes empty for engaged users.
 */
export async function outsideRail(
  input: BuildRailsInput,
  ctx: Awaited<ReturnType<typeof loadUserContext>>,
  supabase: SupabaseClient,
  seenIds: Set<string>,
): Promise<RailResult> {
  void supabase
  const target = input.adventurous ? OUTSIDE_TARGET_ADVENTUROUS : OUTSIDE_TARGET
  const anchorsPicked = input.adventurous ? OUTSIDE_ANCHORS_PICKED_ADVENTUROUS : OUTSIDE_ANCHORS_PICKED

  // Anchors the user has touched, either via selected_genres or by listening.
  const touched = new Map<string, number>() // anchorId → "touch weight" (listened play count, selected genres count more)
  for (const g of ctx.selectedGenres) {
    const anchor = genreToAnchor(g)
    if (anchor) touched.set(anchor, (touched.get(anchor) ?? 0) + 100)
  }
  for (const row of ctx.listened) {
    const primary = row.genres[0]
    if (!primary) continue
    const anchor = genreToAnchor(primary)
    if (!anchor) continue
    touched.set(anchor, (touched.get(anchor) ?? 0) + (row.play_count ?? 1))
  }

  const anchors = listAnchors()
  const untouched = anchors.filter((a) => !touched.has(a.id))
  let picked: Array<{ id: string; lastfmTag: string; label: string }>
  if (untouched.length >= anchorsPicked) {
    // Stable pick across the cache window so the user doesn't see the set
    // shuffle under them on re-fetch.
    const shuffled = seededShuffle(untouched, cacheWindowSeed(input.userId, 'outside'))
    picked = shuffled.slice(0, anchorsPicked)
  } else {
    // All anchors touched — pick least-touched (lowest touch weight).
    const ranked = [...anchors].sort(
      (a, b) => (touched.get(a.id) ?? 0) - (touched.get(b.id) ?? 0),
    )
    picked = ranked.slice(0, anchorsPicked)
  }
  if (picked.length === 0) return { railKey: 'outside', artistIds: [], why: {} }

  // Pick one representative tag per anchor — prefer the anchor's own lastfmTag,
  // otherwise the first leaf in the anchor (deterministic).
  const anchorToTag = new Map<string, string>()
  for (const a of picked) {
    const tag = a.lastfmTag || leafTagsInAnchor(a.id)[0]
    if (tag) anchorToTag.set(a.id, tag)
  }

  // Fetch mid-list (slice 10-30) artists per picked anchor in parallel.
  const tagList = [...anchorToTag.entries()]
  const perAnchor = await Promise.all(
    tagList.map(async ([, tag]) => {
      const names = await getTagArtistNames(tag, OUTSIDE_MID_END)
      return names.slice(OUTSIDE_MID_START, OUTSIDE_MID_END)
    }),
  )

  // Round-robin across picked anchors so no single anchor dominates.
  const nameToAnchor = new Map<string, string>()
  const namesRoundRobin: string[] = []
  let idx = 0
  let exhausted = false
  while (!exhausted) {
    exhausted = true
    for (let i = 0; i < tagList.length; i++) {
      const list = perAnchor[i]
      if (idx < list.length && idx < OUTSIDE_PER_ANCHOR_TARGET) {
        exhausted = false
        const name = list[idx]
        if (!nameToAnchor.has(name)) {
          nameToAnchor.set(name, tagList[i][0])
          namesRoundRobin.push(name)
        }
      }
    }
    idx++
  }

  const resolved = await resolveAndFilter(namesRoundRobin, input.accessToken, supabase, {
    listenedIds: ctx.listenedIds,
    thumbsDownIds: ctx.thumbsDownIds,
    seenIds,
    undergroundMode: input.undergroundMode,
  })

  const artistByName = new Map<string, Artist>()
  for (const a of resolved) artistByName.set(a.name, a)

  const ranked = rankByCurve(namesRoundRobin, artistByName, input.popularityCurve)

  const artistIds: string[] = []
  const why: Record<string, RailWhy> = {}
  const seenArtist = new Set<string>()
  for (const name of ranked) {
    if (artistIds.length >= target) break
    const a = artistByName.get(name)
    if (!a || seenArtist.has(a.id)) continue
    seenArtist.add(a.id)
    artistIds.push(a.id)
    const anchorId = nameToAnchor.get(name)
    const anchorLabel = picked.find((p) => p.id === anchorId)?.label
    why[a.id] = { anchor: anchorLabel ?? anchorId }
  }

  return { railKey: 'outside', artistIds, why }
}

const WILDCARDS_TARGET = 10
const WILDCARDS_TARGET_ADVENTUROUS = 12
const WILDCARDS_SEED_COUNT = 3
const WILDCARDS_SEED_COUNT_ADVENTUROUS = 4
const WILDCARDS_PER_SEED = 4 // tail-bias the similars per seed
const WILDCARDS_PER_SEED_ADVENTUROUS = 5

/**
 * From your wildcards — deep cuts inspired by the user's thumbs-ups.
 *
 * Pick 3 random thumbs-up seeds (stable within the cache window), pull
 * Last.fm similar artists for each, tail-bias (sort match ascending and
 * take the least-similar 3-4) so the results actually surprise. Bypasses
 * other seeds — the point is to amplify the user's explicit likes.
 *
 * Rail hides (returns empty) when the user has no thumbs-ups. The UI
 * substitutes a second Left-field rail in that case.
 */
export async function wildcardsRail(
  input: BuildRailsInput,
  ctx: Awaited<ReturnType<typeof loadUserContext>>,
  supabase: SupabaseClient,
  seenIds: Set<string>,
): Promise<RailResult> {
  const target = input.adventurous ? WILDCARDS_TARGET_ADVENTUROUS : WILDCARDS_TARGET
  const seedCount = input.adventurous ? WILDCARDS_SEED_COUNT_ADVENTUROUS : WILDCARDS_SEED_COUNT
  const perSeedCount = input.adventurous ? WILDCARDS_PER_SEED_ADVENTUROUS : WILDCARDS_PER_SEED

  // Primary seed pool: artists the user thumbs-up'd. If there are none yet
  // (cold-start), fall back to the user's most-played listened artists so the
  // rail still reads as "rabbit holes from your taste" instead of being empty.
  // Excludes thumbs-down artists so a disliked seed never powers the rail.
  let seedIds: string[]
  if (ctx.thumbsUpIds.size > 0) {
    const shuffledIds = seededShuffle([...ctx.thumbsUpIds], cacheWindowSeed(input.userId, 'wildcards'))
    seedIds = shuffledIds.slice(0, seedCount)
  } else {
    const topListened = [...ctx.listened]
      .filter((a) => !ctx.thumbsDownIds.has(a.spotify_artist_id))
      .sort((a, b) => b.play_count - a.play_count)
      .slice(0, seedCount * 2)
      .map((a) => a.spotify_artist_id)
    if (topListened.length === 0) {
      return { railKey: 'wildcards', artistIds: [], why: {} }
    }
    // Stable shuffle over the top pool so the rail rotates week-to-week even
    // when the user's play counts stay put.
    seedIds = seededShuffle(topListened, cacheWindowSeed(input.userId, 'wildcards')).slice(0, seedCount)
  }

  // Resolve seed ids → seed names via artist_search_cache (plus seed_artists as
  // a fallback since those live in `seed_artists` and may pre-date any cache row).
  const seedNameById = new Map<string, string>()
  for (const s of ctx.seedArtists) seedNameById.set(s.spotify_artist_id, s.name)
  const missingIds = seedIds.filter((id) => !seedNameById.has(id))
  if (missingIds.length > 0) {
    const { data } = await supabase
      .from('artist_search_cache')
      .select('spotify_artist_id, artist_data')
      .in('spotify_artist_id', missingIds)
    for (const row of data ?? []) {
      const a = row.artist_data as { name?: string } | null
      if (a?.name) seedNameById.set(row.spotify_artist_id as string, a.name)
    }
  }

  const seedPairs = seedIds
    .map((id) => ({ id, name: seedNameById.get(id) }))
    .filter((p): p is { id: string; name: string } => !!p.name)
  if (seedPairs.length === 0) return { railKey: 'wildcards', artistIds: [], why: {} }

  // Fetch similars per seed in parallel. Tail-bias = sort ascending by match.
  const perSeed = await Promise.all(
    seedPairs.map(async (seed) => {
      const similars = await musicProvider.getSimilarArtistNames(seed.name)
      const tailFirst = [...similars].sort((a, b) => a.match - b.match).slice(0, perSeedCount)
      return { seed, tailFirst }
    }),
  )

  // Round-robin across seeds with provenance map.
  const nameToSeed = new Map<string, { id: string; name: string }>()
  const nameToMatch = new Map<string, number>()
  const namesRoundRobin: string[] = []
  let idx = 0
  let exhausted = false
  while (!exhausted) {
    exhausted = true
    for (const { seed, tailFirst } of perSeed) {
      if (idx < tailFirst.length) {
        exhausted = false
        const ref = tailFirst[idx]
        if (ref.name && !nameToSeed.has(ref.name)) {
          nameToSeed.set(ref.name, seed)
          nameToMatch.set(ref.name, ref.match)
          namesRoundRobin.push(ref.name)
        }
      }
    }
    idx++
  }

  const resolved = await resolveAndFilter(namesRoundRobin, input.accessToken, supabase, {
    listenedIds: ctx.listenedIds,
    thumbsDownIds: ctx.thumbsDownIds,
    seenIds,
    undergroundMode: input.undergroundMode,
  })
  const artistByName = new Map<string, Artist>()
  for (const a of resolved) artistByName.set(a.name, a)

  const ranked = rankByCurve(namesRoundRobin, artistByName, input.popularityCurve)

  const artistIds: string[] = []
  const why: Record<string, RailWhy> = {}
  const seenArtist = new Set<string>()
  for (const name of ranked) {
    if (artistIds.length >= target) break
    const a = artistByName.get(name)
    if (!a || seenArtist.has(a.id)) continue
    seenArtist.add(a.id)
    // Don't surface the thumbs-up seed itself.
    if (ctx.thumbsUpIds.has(a.id)) continue
    artistIds.push(a.id)
    const seed = nameToSeed.get(name)
    const match = nameToMatch.get(name)
    why[a.id] = seed
      ? {
          sourceArtist: seed.name,
          sourceArtistId: seed.id,
          // 1-hop six-degrees chain: surfaced artist is a direct Last.fm similar
          // of the seed. chain[0] = seed (trivial 1.0 match), chain[1] = target.
          chain: match !== undefined
            ? [
                { name: seed.name, match: 1 },
                { name: a.name, match },
              ]
            : null,
        }
      : {}
  }

  return { railKey: 'wildcards', artistIds, why }
}

const LEFTFIELD_TARGET = 10
const LEFTFIELD_TARGET_ADVENTUROUS = 12
const LEFTFIELD_SAMPLE_COUNT = 30 // over-sample so filtering still yields enough picks
const LEFTFIELD_SAMPLE_COUNT_ADVENTUROUS = 28
const LEFTFIELD_MID_START = 10
const LEFTFIELD_MID_END = 30
// Per-tag pick count: Last.fm timeouts + Spotify-search misses + listened/seen
// filters can drop 80%+ of candidates. Pulling multiple names per tag (and
// round-robining so each slot comes from a different tag) gives the filter
// pipeline enough slack to hit TARGET consistently.
const LEFTFIELD_PICKS_PER_TAG = 8
const LEFTFIELD_PICKS_PER_TAG_ADVENTUROUS = 10

/**
 * Left-field wildcards — uniform long-tail sampling of the leaf-tag universe
 * with a light guardrail: exclude tags in the user's top 2 most-played
 * anchors so the rail actually feels "out there".
 *
 * Per sampled tag we pull Last.fm top-30, pick a seeded-deterministic
 * mid-list position (10-30 range) so the choice is stable within the cache
 * window but varies across windows. No provenance chain — the whole point
 * is "here's a leaf from the sonic map".
 */
export async function leftfieldRail(
  input: BuildRailsInput,
  ctx: Awaited<ReturnType<typeof loadUserContext>>,
  supabase: SupabaseClient,
  seenIds: Set<string>,
  opts: { seedKey?: string; excludeIds?: Set<string> } = {},
): Promise<RailResult> {
  try {
    const seedKey = opts.seedKey ?? 'leftfield'
    const excludeIds = opts.excludeIds ?? new Set<string>()
    const target = input.adventurous ? LEFTFIELD_TARGET_ADVENTUROUS : LEFTFIELD_TARGET

    const topAnchors = computeTopAnchors(ctx.listened) // [] when <2 anchors
    const excluded = new Set(topAnchors)

    const allLeaves = allLeavesWithAnchor()
    const pool = allLeaves.filter((l) => !excluded.has(l.anchorId))
    if (pool.length === 0) return { railKey: 'leftfield', artistIds: [], why: {} }

    const sampleCount = input.adventurous ? LEFTFIELD_SAMPLE_COUNT_ADVENTUROUS : LEFTFIELD_SAMPLE_COUNT
    const picksPerTag = input.adventurous ? LEFTFIELD_PICKS_PER_TAG_ADVENTUROUS : LEFTFIELD_PICKS_PER_TAG
    const seed = cacheWindowSeed(input.userId, seedKey)
    const sampled = seededShuffle(pool, seed).slice(0, sampleCount)

    // Per sampled tag, pull `picksPerTag` candidates starting at a seeded
    // offset within the mid-list slice. Fallback: niche tags often have <10
    // top artists — when the mid-list slice is empty, fall back to the whole
    // top-N list so the rail still produces picks.
    const perTag = await Promise.all(
      sampled.map(async (leaf) => {
        const names = await getTagArtistNames(leaf.lastfmTag, LEFTFIELD_MID_END)
        if (names.length === 0) return null
        const mid = names.slice(LEFTFIELD_MID_START, LEFTFIELD_MID_END)
        const slice = mid.length > 0 ? mid : names
        const offset = seed ^ hashString(leaf.lastfmTag)
        const start = offset % slice.length
        const picksForTag: string[] = []
        const seenName = new Set<string>()
        for (let k = 0; k < picksPerTag && picksForTag.length < slice.length; k++) {
          const name = slice[(start + k) % slice.length]
          if (seenName.has(name)) continue
          seenName.add(name)
          picksForTag.push(name)
        }
        return { tag: leaf.lastfmTag, anchorId: leaf.anchorId, names: picksForTag }
      }),
    )

    // Round-robin across tags: round k pulls the k-th name from each tag so
    // variety wins over any single tag flooding the candidate list.
    const picks = perTag.filter((p): p is { tag: string; anchorId: string; names: string[] } => !!p)
    const namesRoundRobin: string[] = []
    const nameMeta = new Map<string, { tag: string; anchorId: string }>()
    for (let k = 0; k < picksPerTag; k++) {
      for (const p of picks) {
        if (k >= p.names.length) continue
        const name = p.names[k]
        if (nameMeta.has(name)) continue
        nameMeta.set(name, { tag: p.tag, anchorId: p.anchorId })
        namesRoundRobin.push(name)
      }
    }

    const resolved = await resolveAndFilter(namesRoundRobin, input.accessToken, supabase, {
      listenedIds: ctx.listenedIds,
      thumbsDownIds: ctx.thumbsDownIds,
      seenIds,
      undergroundMode: input.undergroundMode,
    })
    const artistByName = new Map<string, Artist>()
    for (const a of resolved) artistByName.set(a.name, a)

    const artistIds: string[] = []
    const why: Record<string, RailWhy> = {}
    const seenArtist = new Set<string>()
    for (const name of namesRoundRobin) {
      if (artistIds.length >= target) break
      const a = artistByName.get(name)
      if (!a || seenArtist.has(a.id)) continue
      if (excludeIds.has(a.id)) continue
      const meta = nameMeta.get(name)
      if (!meta) continue
      seenArtist.add(a.id)
      artistIds.push(a.id)
      why[a.id] = { tag: meta.tag, anchor: meta.anchorId }
    }

    return { railKey: 'leftfield', artistIds, why }
  } catch (e) {
    console.error('[leftfield] THREW', e instanceof Error ? e.message : String(e), e instanceof Error ? e.stack : '')
    return { railKey: 'leftfield', artistIds: [], why: {} }
  }
}

function hashString(s: string): number {
  let h = 2166136261 >>> 0
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619) >>> 0
  }
  return h
}

// ── Orchestrator ────────────────────────────────────────────────────────────

export interface HydratedRailArtist {
  id: string
  name: string
  genres?: string[]
  imageUrl?: string | null
  popularity?: number
  artist_color?: string | null
}

export interface BuildRailsResult {
  rails: RailResult[]
  cacheHit: boolean
  /** Populated when `opts.hydrate === true`. Maps spotify_artist_id → cached artist record. */
  hydrated?: Map<string, HydratedRailArtist>
}

async function hydrateRailArtists(
  supabase: SupabaseClient,
  rails: RailResult[],
): Promise<Map<string, HydratedRailArtist>> {
  const allIds = Array.from(new Set(rails.flatMap((r) => r.artistIds)))
  const byId = new Map<string, HydratedRailArtist>()
  if (allIds.length === 0) return byId
  const { data: rows } = await supabase
    .from('artist_search_cache')
    .select('spotify_artist_id, artist_data, artist_color')
    .in('spotify_artist_id', allIds)
  for (const row of rows ?? []) {
    const a = (row.artist_data ?? {}) as Omit<HydratedRailArtist, 'id' | 'artist_color'>
    byId.set(row.spotify_artist_id as string, {
      ...a,
      id: row.spotify_artist_id as string,
      artist_color: (row.artist_color as string | null) ?? null,
    })
  }
  return byId
}

/**
 * Belt-and-braces pop cap. Runs after hydration so it catches (a) stale
 * explore_cache rows from before filter fixes, (b) artist_search_cache
 * popularity drift from ≤50 → >50 after caching, and (c) any future filter
 * bypass we haven't thought of. Purely DB-local — zero Spotify/Last.fm calls.
 * No-op without hydration data or when undergroundMode is off.
 */
function enforceUndergroundCap(
  rails: RailResult[],
  hydrated: Map<string, HydratedRailArtist> | undefined,
  undergroundMode: boolean | undefined,
): void {
  if (!undergroundMode || !hydrated) return
  for (const rail of rails) {
    rail.artistIds = rail.artistIds.filter((id) => {
      const a = hydrated.get(id)
      // When hydration is missing (cache miss), drop — we can't prove ≤50.
      if (!a) return false
      return (a.popularity ?? 0) <= UNDERGROUND_MAX_POPULARITY
    })
  }
}

/**
 * Top-level entrypoint. Reads `explore_cache`, returns cached rails when
 * fresh, otherwise runs all four rail generators in parallel, writes the
 * results, and returns them.
 *
 * `force = true` bypasses the cache (used by the Regenerate button).
 * `hydrate = true` additionally resolves each rail's artist IDs against
 * `artist_search_cache` and returns a `hydrated` Map, in parallel with the
 * cache upsert so it doesn't add serial latency on cache misses.
 */
export async function buildExploreRails(
  input: BuildRailsInput,
  opts: { force?: boolean; hydrate?: boolean } = {},
): Promise<BuildRailsResult> {
  const supabase = createServiceClient()
  const now = new Date()

  if (!opts.force) {
    const { data: cached } = await supabase
      .from('explore_cache')
      .select('rail_key, artist_ids, why, expires_at')
      .eq('user_id', input.userId)
      .gt('expires_at', now.toISOString())

    if (cached && cached.length === RAIL_KEYS.length) {
      const rails: RailResult[] = cached.map((row) => ({
        railKey: row.rail_key as RailKey,
        artistIds: (row.artist_ids ?? []) as string[],
        why: (row.why ?? {}) as Record<string, RailWhy>,
      }))
      const hydrated = opts.hydrate ? await hydrateRailArtists(supabase, rails) : undefined
      enforceUndergroundCap(rails, hydrated, input.undergroundMode)
      return { cacheHit: true, rails, hydrated }
    }
  }

  const [ctx, seenIds] = await Promise.all([
    loadUserContext(supabase, input.userId),
    loadSeenIds(supabase, input.userId),
  ])

  // allSettled so one rail throwing doesn't nuke the whole explore generation.
  // Each rail already has its own internal try/catch for Last.fm calls; this is
  // belt-and-braces against unexpected DB / null-deref errors.
  const railFns: Array<{ key: RailKey; run: () => Promise<RailResult> }> = [
    { key: "adjacent", run: () => adjacentRail(input, ctx, supabase, seenIds) },
    { key: "outside", run: () => outsideRail(input, ctx, supabase, seenIds) },
    { key: "wildcards", run: () => wildcardsRail(input, ctx, supabase, seenIds) },
    { key: "leftfield", run: () => leftfieldRail(input, ctx, supabase, seenIds) },
  ]
  const settled = await Promise.allSettled(railFns.map((r) => r.run()))
  const rails: RailResult[] = settled.map((s, i) => {
    if (s.status === "fulfilled") return s.value
    console.error(`[explore-engine] rail=${railFns[i].key} failed:`, s.reason)
    return { railKey: railFns[i].key, artistIds: [], why: {} }
  })

  // Wildcards → second-leftfield fallback. When the user has no thumbs-ups,
  // wildcardsRail returns empty by design. Rather than leave a dead rail, swap
  // in a second left-field sample using a distinct seed key + excluding the
  // primary leftfield's picks so the two rails show different artists.
  if (ctx.thumbsUpIds.size === 0) {
    const primaryLeftfield = rails.find((r) => r.railKey === 'leftfield')
    const excludeIds = new Set(primaryLeftfield?.artistIds ?? [])
    const fallback = await leftfieldRail(input, ctx, supabase, seenIds, {
      seedKey: 'wildcards-fallback',
      excludeIds,
    })
    const wildcardsIdx = rails.findIndex((r) => r.railKey === 'wildcards')
    if (wildcardsIdx >= 0) {
      rails[wildcardsIdx] = {
        railKey: 'wildcards',
        artistIds: fallback.artistIds,
        why: {
          ...fallback.why,
          [RAIL_META_KEY]: { fallbackKind: 'leftfield-for-wildcards' },
        },
      }
    }
  }

  // Minimum-floor topup. If any rail ends up below MIN_PICKS (matches the
  // client's visibility cutoff in explore-client.tsx), blend in leftfield-
  // sampled picks until it clears the floor. Keeps each rail's identity
  // (original title/subtitle, original native picks first) while guaranteeing
  // all four rails render for users with thin signal. Excludes IDs already in
  // any rail so the topup never creates cross-rail duplicates.
  const MIN_PICKS_FLOOR = 5
  const shortRails = rails.filter((r) => r.artistIds.length < MIN_PICKS_FLOOR && r.railKey !== 'leftfield')
  if (shortRails.length > 0) {
    const existingIds = new Set<string>()
    for (const r of rails) for (const id of r.artistIds) existingIds.add(id)

    for (const r of shortRails) {
      const need = MIN_PICKS_FLOOR - r.artistIds.length
      if (need <= 0) continue
      const topup = await leftfieldRail(input, ctx, supabase, seenIds, {
        seedKey: `${r.railKey}-topup`,
        excludeIds: existingIds,
      })
      const added: string[] = []
      for (const id of topup.artistIds) {
        if (existingIds.has(id)) continue
        added.push(id)
        existingIds.add(id)
        if (added.length >= need) break
      }
      if (added.length > 0) {
        r.artistIds = [...r.artistIds, ...added]
        for (const id of added) {
          if (!r.why[id]) r.why[id] = (topup.why[id] ?? {})
        }
      }
    }
  }

  const expiresAt = new Date(now.getTime() + EXPLORE_CACHE_TTL_MS).toISOString()
  const rows = rails.map((r) => ({
    user_id: input.userId,
    rail_key: r.railKey,
    artist_ids: r.artistIds,
    why: r.why,
    generated_at: now.toISOString(),
    expires_at: expiresAt,
  }))

  // Upsert + hydration are independent — fire in parallel to save a roundtrip.
  const [{ error }, hydrated] = await Promise.all([
    supabase.from('explore_cache').upsert(rows, { onConflict: 'user_id,rail_key' }),
    opts.hydrate ? hydrateRailArtists(supabase, rails) : Promise.resolve(undefined),
  ])

  if (error) {
    console.error('[explore-engine] cache upsert failed', error.message)
  }

  enforceUndergroundCap(rails, hydrated, input.undergroundMode)
  return { rails, cacheHit: false, hydrated }
}

/**
 * Invalidate cached Explore rails for a user. Omit `rails` to wipe every rail
 * (settings / seed / Adventurous changes — the full taste model shifted).
 * Pass `rails` to narrow-invalidate just those rail rows (Explore feedback
 * where the signal is owned by a single rail; other rails pick the signal up
 * on their own 24h TTL via the persisted feedback row).
 */
export async function invalidateExploreCache(
  userId: string,
  rails?: RailKey[],
): Promise<void> {
  const supabase = createServiceClient()
  let query = supabase.from('explore_cache').delete().eq('user_id', userId)
  if (rails && rails.length > 0) {
    query = query.in('rail_key', rails)
  }
  const { error } = await query
  if (error) console.error('[explore-engine] invalidate failed', error.message)
}

// Internal helpers exposed for rail implementations in subsequent commits.
export const _internal = {
  loadUserContext,
  resolveAndFilter,
  buildEnrichArtist,
}
