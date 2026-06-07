import { type NextRequest } from "next/server"
import { auth } from "@/lib/auth"
import { apiError, apiUnauthorized } from "@/lib/errors"
import { enforceSameOrigin } from "@/lib/csrf"
import { createServiceClient } from "@/lib/supabase/server"
import { isValidSpotifyId } from "@/lib/spotify-ids"
import { resolveArtistExternalIds } from "@/lib/music-provider/musicbrainz"
import type { Artist } from "@/lib/music-provider/types"

// Resolution is low-volume (only when a user SELECTS a Last.fm-only suggestion,
// not per keystroke) and each miss can trigger a MusicBrainz call, so cap it
// tighter than the typeahead search.
const RESOLVE_MAX_PER_MIN = 30
const RESOLVE_WINDOW_MS = 60_000
const resolveBuckets = new Map<string, { count: number; windowStart: number }>()

const MBID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function isRateLimited(userId: string): boolean {
  const now = Date.now()
  const bucket = resolveBuckets.get(userId)
  if (!bucket || now - bucket.windowStart > RESOLVE_WINDOW_MS) {
    resolveBuckets.set(userId, { count: 1, windowStart: now })
    return false
  }
  if (bucket.count >= RESOLVE_MAX_PER_MIN) return true
  bucket.count += 1
  return false
}

/** Exact-name cache lookup → the cached artist's real Spotify id, or null. */
async function resolveFromCache(name: string): Promise<{ id: string; imageUrl: string | null } | null> {
  try {
    const supabase = createServiceClient()
    const { data, error } = await supabase
      .from("artist_search_cache")
      .select("artist_data")
      .eq("name_lower", name.toLowerCase())
      .limit(1)
      .maybeSingle()
    if (error || !data) return null
    const artist = data.artist_data as Artist
    if (artist && isValidSpotifyId(artist.id)) {
      return { id: artist.id, imageUrl: artist.imageUrl ?? null }
    }
    return null
  } catch {
    return null
  }
}

/**
 * Resolve a Last.fm-sourced onboarding suggestion to a real Spotify artist id,
 * so a seed can persist (spotify_artist_id is the load-bearing key until the
 * Stage-2 cut). Tries the shared artist cache by exact name, then MusicBrainz
 * url-rels by mbid. Returns 404 when neither yields a valid id — the client
 * blocks that selection. Makes ZERO Spotify calls.
 */
export async function POST(req: NextRequest) {
  const blocked = enforceSameOrigin(req)
  if (blocked) return blocked
  const session = await auth()
  if (!session?.user?.id) return apiUnauthorized()

  if (isRateLimited(session.user.id)) {
    return apiError("Too many lookups — slow down for a moment", 429)
  }

  let body: { name?: unknown; mbid?: unknown }
  try {
    body = await req.json()
  } catch {
    return apiError("Invalid JSON body", 400)
  }

  if (typeof body.name !== "string") {
    return apiError("name must be a string", 400)
  }
  const name = body.name.trim()
  if (name.length === 0 || name.length > 200) {
    return apiError("name must be 1–200 chars", 400)
  }
  const mbid = typeof body.mbid === "string" && MBID_RE.test(body.mbid) ? body.mbid : null

  // 1. Cache by exact name (real Spotify id, image).
  const cached = await resolveFromCache(name)
  if (cached) {
    return Response.json({ id: cached.id, name, imageUrl: cached.imageUrl })
  }

  // 2. MusicBrainz url-rels by mbid (keyless; 1-req/s limited internally).
  if (mbid) {
    const { spotifyId } = await resolveArtistExternalIds(mbid)
    if (spotifyId && isValidSpotifyId(spotifyId)) {
      console.log(`[onboard-resolve] mb-resolved name="${name}" mbid=${mbid}`)
      return Response.json({ id: spotifyId, name, imageUrl: null })
    }
  }

  console.log(`[onboard-resolve] unresolved name="${name}" mbid=${mbid ?? "-"}`)
  return apiError("Could not resolve this artist", 404)
}
