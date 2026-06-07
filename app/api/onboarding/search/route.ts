import { type NextRequest } from "next/server"
import { auth } from "@/lib/auth"
import { apiError, apiUnauthorized } from "@/lib/errors"
import { createServiceClient } from "@/lib/supabase/server"
import { searchArtistCandidates } from "@/lib/music-provider/lastfm-search"
import { normalizeArtistName } from "@/lib/history/name-utils"
import type { Artist } from "@/lib/music-provider/types"

// Per-user in-memory rate limit. A debounced UI already throttles typing; this
// is a per-instance speed bump against abuse. Last.fm calls additionally route
// through the shared limiter (#150), so this protects that budget too.
const SEARCH_MAX_PER_MIN = 120
const SEARCH_WINDOW_MS = 60_000
const searchBuckets = new Map<string, { count: number; windowStart: number }>()

// Minimum query length enforced server-side (the client also gates this).
const MIN_QUERY_LEN = 2
// If the cache already returns at least this many hits, skip Last.fm entirely.
const CACHE_SUFFICIENT = 5
const RESULT_CAP = 10

function isSearchRateLimited(userId: string): boolean {
  const now = Date.now()
  const bucket = searchBuckets.get(userId)
  if (!bucket || now - bucket.windowStart > SEARCH_WINDOW_MS) {
    searchBuckets.set(userId, { count: 1, windowStart: now })
    return false
  }
  if (bucket.count >= SEARCH_MAX_PER_MIN) return true
  bucket.count += 1
  return false
}

// Escape %/_/\ so user input can't turn into a wildcard in ILIKE.
function escapeIlike(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_")
}

/**
 * Suggestion returned to the onboarding typeahead. Cache hits carry a real
 * Spotify id (resolve-free). Last.fm-only suggestions carry a synthetic `lf:`
 * id + mbid and `needsResolve: true` — the client resolves a real Spotify id on
 * selection (cache/MusicBrainz) before persisting a seed.
 */
interface OnboardingSuggestion {
  id: string
  name: string
  genres: string[]
  imageUrl: string | null
  popularity: number
  needsResolve?: boolean
  mbid?: string | null
}

async function searchCachedArtists(query: string, limit = RESULT_CAP): Promise<Artist[]> {
  try {
    const supabase = createServiceClient()
    const pattern = `${escapeIlike(query.toLowerCase())}%`
    const { data, error } = await supabase
      .from("artist_search_cache")
      .select("artist_data")
      .ilike("name_lower", pattern)
      .limit(limit)
    if (error) {
      console.log(`[onboard-search] cache read-fail err="${error.message}"`)
      return []
    }
    return (data ?? []).map((r) => r.artist_data as Artist)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.log(`[onboard-search] cache throw err="${msg}"`)
    return []
  }
}

function cacheToSuggestion(a: Artist): OnboardingSuggestion {
  return {
    id: a.id,
    name: a.name,
    genres: a.genres ?? [],
    imageUrl: a.imageUrl ?? null,
    popularity: a.popularity ?? 0,
    needsResolve: false,
  }
}

/**
 * Onboarding artist search — cache-first, Last.fm on miss, ZERO Spotify
 * client-credential calls (the #1 shared-key burner, removed in #156). The
 * cache covers popular artists with real Spotify ids; Last.fm fills the tail
 * (resolved to a real id on selection).
 */
export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    console.log("[onboard-search] unauth")
    return apiUnauthorized()
  }

  if (isSearchRateLimited(session.user.id)) {
    console.log(`[onboard-search] self-rate-limited userId=${session.user.id}`)
    return apiError("Too many searches — slow down for a moment", 429)
  }

  const query = req.nextUrl.searchParams.get("q")
  if (query === null) {
    return apiError("Query parameter 'q' is required", 400)
  }
  if (query.length > 200) {
    return apiError("Query too long", 400)
  }

  const trimmed = query.trim()
  // Server-side minimum length: too-short queries return no suggestions (not an
  // error) so the typeahead simply waits for more input.
  if (trimmed.length < MIN_QUERY_LEN) {
    return Response.json({ artists: [] })
  }

  // 1. Cache-first (real Spotify ids, genres, images).
  const cached = await searchCachedArtists(trimmed)
  const suggestions: OnboardingSuggestion[] = cached.map(cacheToSuggestion)

  // 2. Supplement with Last.fm only when the cache is thin — keeps live Last.fm
  //    volume low and prefers our enriched cache rows.
  if (suggestions.length < CACHE_SUFFICIENT) {
    const seen = new Set(suggestions.map((s) => normalizeArtistName(s.name)))
    const candidates = await searchArtistCandidates(trimmed)
    for (const c of candidates) {
      if (suggestions.length >= RESULT_CAP) break
      const norm = normalizeArtistName(c.name)
      if (seen.has(norm)) continue
      seen.add(norm)
      suggestions.push({
        id: `lf:${c.mbid ?? norm}`,
        name: c.name,
        genres: [],
        imageUrl: c.imageUrl,
        popularity: 0,
        needsResolve: true,
        mbid: c.mbid,
      })
    }
  }

  console.log(
    `[onboard-search] q="${trimmed}" n=${suggestions.length} ` +
      `(cache=${cached.length} lastfm=${suggestions.length - cached.length})`,
  )
  return Response.json({ artists: suggestions })
}
