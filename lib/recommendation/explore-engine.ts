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
  adjacentGenres,
  allLeavesWithAnchor,
  genreToAnchor,
  leafTagsInAnchor,
  listAnchors,
} from '@/lib/genre/adjacency'

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
}

export interface RailResult {
  railKey: RailKey
  artistIds: string[]
  why: Record<string, RailWhy>
}

export interface BuildRailsInput {
  userId: string
  accessToken: string
  adventurous: boolean
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
export function cacheWindowSeed(userId: string, railKey: RailKey): number {
  const weekStart = Math.floor(Date.now() / (7 * 24 * 60 * 60 * 1000))
  let h = 2166136261 >>> 0
  const s = `${userId}:${railKey}:${weekStart}`
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

async function loadUserContext(supabase: SupabaseClient, userId: string) {
  const [{ data: user }, { data: seedArtists }, { data: listenedRows }, { data: thumbsUp }, { data: thumbsDown }] = await Promise.all([
    supabase.from('users').select('id, selected_genres, adventurous').eq('id', userId).maybeSingle(),
    supabase.from('seed_artists').select('spotify_artist_id, name').eq('user_id', userId),
    supabase.from('listened_artists').select('spotify_artist_id, play_count').eq('user_id', userId).not('spotify_artist_id', 'is', null),
    supabase.from('feedback').select('spotify_artist_id').eq('user_id', userId).eq('signal', 'thumbs_up').is('deleted_at', null),
    supabase.from('feedback').select('spotify_artist_id').eq('user_id', userId).eq('signal', 'thumbs_down').is('deleted_at', null),
  ])

  // Hydrate listened artists with their genres via artist_search_cache.
  // Batched in chunks of 200 to stay well within Postgres IN-list limits.
  const listenedIds = (listenedRows ?? []).map((r) => r.spotify_artist_id as string)
  const genreById = new Map<string, string[]>()
  const CHUNK = 200
  for (let i = 0; i < listenedIds.length; i += CHUNK) {
    const chunk = listenedIds.slice(i, i + CHUNK)
    if (chunk.length === 0) continue
    const { data } = await supabase
      .from('artist_search_cache')
      .select('spotify_artist_id, artist_data')
      .in('spotify_artist_id', chunk)
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
  filters: { listenedIds: Set<string>; thumbsDownIds: Set<string>; seenIds: Set<string> },
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

const ADJACENT_TARGET = 10
const ADJACENT_TARGET_ADVENTUROUS = 12
const ADJACENT_PER_TAG = 3
const ADJACENT_PER_TAG_ADVENTUROUS = 5
const ADJACENT_MAX_TAGS = 12
const ADJACENT_MAX_TAGS_ADVENTUROUS = 18

/**
 * Adjacent rail — genres one hop away from the user's stated taste.
 *
 * Seeds are top 5 selected_genres. When empty (new user), we fall back to
 * deriving primary genres from their `seed_artists`. For each seed genre
 * we pull close-distance neighbours from the coord map, fetch top artists
 * per neighbour, and round-robin across source tags so no single neighbour
 * dominates.
 */
export async function adjacentRail(
  input: BuildRailsInput,
  ctx: Awaited<ReturnType<typeof loadUserContext>>,
  supabase: SupabaseClient,
  seenIds: Set<string>,
): Promise<RailResult> {
  const target = input.adventurous ? ADJACENT_TARGET_ADVENTUROUS : ADJACENT_TARGET
  const perTag = input.adventurous ? ADJACENT_PER_TAG_ADVENTUROUS : ADJACENT_PER_TAG
  const maxTags = input.adventurous ? ADJACENT_MAX_TAGS_ADVENTUROUS : ADJACENT_MAX_TAGS
  const seedTags = await resolveAdjacentSeeds(ctx, supabase)
  if (seedTags.length === 0) return { railKey: 'adjacent', artistIds: [], why: {} }

  // Collect adjacent tags from the user's top seeds. Cap to keep Last.fm
  // call budget bounded.
  const adjacentByTag = new Map<string, string[]>()
  const ownTagSet = new Set(seedTags.map((t) => t.toLowerCase()))
  for (const seed of seedTags.slice(0, 5)) {
    const neighbours = adjacentGenres(seed, 'close')
    for (const tag of neighbours) {
      if (ownTagSet.has(tag.toLowerCase())) continue
      if (adjacentByTag.has(tag)) continue
      adjacentByTag.set(tag, [])
      if (adjacentByTag.size >= maxTags) break
    }
    if (adjacentByTag.size >= maxTags) break
  }
  if (adjacentByTag.size === 0) return { railKey: 'adjacent', artistIds: [], why: {} }

  // Fetch top artists per adjacent tag in parallel.
  const tagList = [...adjacentByTag.keys()]
  const perTagResults = await Promise.all(
    tagList.map((tag) => getTagArtistNames(tag, perTag + 2)),
  )
  for (let i = 0; i < tagList.length; i++) {
    adjacentByTag.set(tagList[i], perTagResults[i].slice(0, perTag + 2))
  }

  // Round-robin across tags → name list + name→tag map for provenance.
  const nameToTag = new Map<string, string>()
  const namesRoundRobin: string[] = []
  let exhausted = false
  let idx = 0
  while (!exhausted) {
    exhausted = true
    for (const tag of tagList) {
      const list = adjacentByTag.get(tag)!
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
  })

  // Preserve round-robin name ordering when picking.
  const artistByName = new Map<string, Artist>()
  for (const a of resolved) artistByName.set(a.name, a)

  const artistIds: string[] = []
  const why: Record<string, RailWhy> = {}
  const seen = new Set<string>()
  for (const name of namesRoundRobin) {
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

/**
 * Pick the seed tags the adjacent rail should hop from.
 *
 * Primary: user's selected_genres (top 5).
 * Fallback: primary Spotify genre of their seed_artists. We look those up in
 * `artist_search_cache` (no fresh Spotify fetch — if a seed artist has never
 * been resolved, the main feed resolution will populate it, and on a later
 * Explore build this fallback will pick them up).
 */
async function resolveAdjacentSeeds(
  ctx: Awaited<ReturnType<typeof loadUserContext>>,
  supabase: SupabaseClient,
): Promise<string[]> {
  if (ctx.selectedGenres.length > 0) return ctx.selectedGenres.slice(0, 5)
  if (ctx.seedArtists.length === 0) return []

  const ids = ctx.seedArtists.map((s) => s.spotify_artist_id)
  const { data } = await supabase
    .from('artist_search_cache')
    .select('spotify_artist_id, artist_data')
    .in('spotify_artist_id', ids)

  const genres: string[] = []
  const seen = new Set<string>()
  for (const row of data ?? []) {
    const artist = row.artist_data as { genres?: string[] } | null
    const primary = artist?.genres?.[0]
    if (primary && !seen.has(primary)) {
      seen.add(primary)
      genres.push(primary)
    }
  }
  return genres.slice(0, 5)
}

const OUTSIDE_TARGET = 10
const OUTSIDE_TARGET_ADVENTUROUS = 12
const OUTSIDE_ANCHORS_PICKED = 3
const OUTSIDE_ANCHORS_PICKED_ADVENTUROUS = 4
const OUTSIDE_MID_START = 10 // slice start of Last.fm top artists — skip mainstream head
const OUTSIDE_MID_END = 30   // exclusive slice end
const OUTSIDE_PER_ANCHOR_TARGET = 4

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
  const thumbsUpIds = [...ctx.thumbsUpIds]
  if (thumbsUpIds.length === 0) return { railKey: 'wildcards', artistIds: [], why: {} }

  const target = input.adventurous ? WILDCARDS_TARGET_ADVENTUROUS : WILDCARDS_TARGET
  const seedCount = input.adventurous ? WILDCARDS_SEED_COUNT_ADVENTUROUS : WILDCARDS_SEED_COUNT
  const perSeedCount = input.adventurous ? WILDCARDS_PER_SEED_ADVENTUROUS : WILDCARDS_PER_SEED

  const shuffledIds = seededShuffle(thumbsUpIds, cacheWindowSeed(input.userId, 'wildcards'))
  const seedIds = shuffledIds.slice(0, seedCount)

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

const LEFTFIELD_TARGET = 6
const LEFTFIELD_TARGET_ADVENTUROUS = 12
const LEFTFIELD_SAMPLE_COUNT = 18 // over-sample so filtering still yields enough picks
const LEFTFIELD_SAMPLE_COUNT_ADVENTUROUS = 28
const LEFTFIELD_MID_START = 10
const LEFTFIELD_MID_END = 30

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
): Promise<RailResult> {
  try {
  const target = input.adventurous ? LEFTFIELD_TARGET_ADVENTUROUS : LEFTFIELD_TARGET

  const topAnchors = computeTopAnchors(ctx.listened) // [] when <2 anchors
  const excluded = new Set(topAnchors)

  const allLeaves = allLeavesWithAnchor()
  const pool = allLeaves.filter((l) => !excluded.has(l.anchorId))
  if (pool.length === 0) return { railKey: 'leftfield', artistIds: [], why: {} }

  const sampleCount = input.adventurous ? LEFTFIELD_SAMPLE_COUNT_ADVENTUROUS : LEFTFIELD_SAMPLE_COUNT
  const seed = cacheWindowSeed(input.userId, 'leftfield')
  const sampled = seededShuffle(pool, seed).slice(0, sampleCount)

  // For each sampled tag, pick one candidate from Last.fm's mid-list slice.
  // We hash (userId:leafieldTag) to pick a stable offset inside the slice.
  // Fallback: niche tags often have <10 top artists — when the mid-list
  // slice is empty, fall back to the whole top-N list so the rail still
  // produces picks rather than going silently empty.
  const perTag = await Promise.all(
    sampled.map(async (leaf) => {
      const names = await getTagArtistNames(leaf.lastfmTag, LEFTFIELD_MID_END)
      if (names.length === 0) return null
      const mid = names.slice(LEFTFIELD_MID_START, LEFTFIELD_MID_END)
      const slice = mid.length > 0 ? mid : names
      const offset = cacheWindowSeed(input.userId, 'leftfield') ^ hashString(leaf.lastfmTag)
      const pick = slice[offset % slice.length]
      return { tag: leaf.lastfmTag, anchorId: leaf.anchorId, name: pick }
    }),
  )

  const picks = perTag.filter((p): p is { tag: string; anchorId: string; name: string } => !!p)
  const namesFlat = picks.map((p) => p.name)
  const resolved = await resolveAndFilter(namesFlat, input.accessToken, supabase, {
    listenedIds: ctx.listenedIds,
    thumbsDownIds: ctx.thumbsDownIds,
    seenIds,
  })
  const artistByName = new Map<string, Artist>()
  for (const a of resolved) artistByName.set(a.name, a)

  const artistIds: string[] = []
  const why: Record<string, RailWhy> = {}
  const seenArtist = new Set<string>()
  for (const pick of picks) {
    if (artistIds.length >= target) break
    const a = artistByName.get(pick.name)
    if (!a || seenArtist.has(a.id)) continue
    seenArtist.add(a.id)
    artistIds.push(a.id)
    why[a.id] = { tag: pick.tag, anchor: pick.anchorId }
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

export interface BuildRailsResult {
  rails: RailResult[]
  cacheHit: boolean
}

/**
 * Top-level entrypoint. Reads `explore_cache`, returns cached rails when
 * fresh, otherwise runs all four rail generators in parallel, writes the
 * results, and returns them.
 *
 * `force = true` bypasses the cache (used by the Regenerate button).
 */
export async function buildExploreRails(
  input: BuildRailsInput,
  opts: { force?: boolean } = {},
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
      return {
        cacheHit: true,
        rails: cached.map((row) => ({
          railKey: row.rail_key as RailKey,
          artistIds: (row.artist_ids ?? []) as string[],
          why: (row.why ?? {}) as Record<string, RailWhy>,
        })),
      }
    }
  }

  const [ctx, seenIds] = await Promise.all([
    loadUserContext(supabase, input.userId),
    loadSeenIds(supabase, input.userId),
  ])

  const rails = await Promise.all([
    adjacentRail(input, ctx, supabase, seenIds),
    outsideRail(input, ctx, supabase, seenIds),
    wildcardsRail(input, ctx, supabase, seenIds),
    leftfieldRail(input, ctx, supabase, seenIds),
  ])

  const expiresAt = new Date(now.getTime() + EXPLORE_CACHE_TTL_MS).toISOString()
  const rows = rails.map((r) => ({
    user_id: input.userId,
    rail_key: r.railKey,
    artist_ids: r.artistIds,
    why: r.why,
    generated_at: now.toISOString(),
    expires_at: expiresAt,
  }))

  const { error } = await supabase
    .from('explore_cache')
    .upsert(rows, { onConflict: 'user_id,rail_key' })

  if (error) {
    console.error('[explore-engine] cache upsert failed', error.message)
  }

  return { rails, cacheHit: false }
}

/**
 * Invalidate the user's entire explore cache. Called on thumbs-up,
 * thumbs-down, seed change, selected_genres change, and Adventurous toggle.
 * Delete-all is cheap (≤ 4 rows) and simpler than per-rail targeting.
 */
export async function invalidateExploreCache(userId: string): Promise<void> {
  const supabase = createServiceClient()
  const { error } = await supabase.from('explore_cache').delete().eq('user_id', userId)
  if (error) console.error('[explore-engine] invalidate failed', error.message)
}

// Internal helpers exposed for rail implementations in subsequent commits.
export const _internal = {
  loadUserContext,
  resolveAndFilter,
  buildEnrichArtist,
}
