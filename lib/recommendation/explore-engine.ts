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
import { genreToAnchor } from '@/lib/genre/adjacency'

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

export async function adjacentRail(
  input: BuildRailsInput,
  ctx: Awaited<ReturnType<typeof loadUserContext>>,
  supabase: SupabaseClient,
  seenIds: Set<string>,
): Promise<RailResult> {
  void input; void ctx; void supabase; void seenIds
  return { railKey: 'adjacent', artistIds: [], why: {} }
}

export async function outsideRail(
  input: BuildRailsInput,
  ctx: Awaited<ReturnType<typeof loadUserContext>>,
  supabase: SupabaseClient,
  seenIds: Set<string>,
): Promise<RailResult> {
  void input; void ctx; void supabase; void seenIds
  return { railKey: 'outside', artistIds: [], why: {} }
}

export async function wildcardsRail(
  input: BuildRailsInput,
  ctx: Awaited<ReturnType<typeof loadUserContext>>,
  supabase: SupabaseClient,
  seenIds: Set<string>,
): Promise<RailResult> {
  void input; void ctx; void supabase; void seenIds
  return { railKey: 'wildcards', artistIds: [], why: {} }
}

export async function leftfieldRail(
  input: BuildRailsInput,
  ctx: Awaited<ReturnType<typeof loadUserContext>>,
  supabase: SupabaseClient,
  seenIds: Set<string>,
): Promise<RailResult> {
  void input; void ctx; void supabase; void seenIds
  return { railKey: 'leftfield', artistIds: [], why: {} }
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
