import { type NextRequest } from "next/server"
import { auth } from "@/lib/auth"
import { apiError, apiUnauthorized } from "@/lib/errors"
import { enforceSameOrigin } from "@/lib/csrf"
import { createServiceClient } from "@/lib/supabase/server"
import { isValidSpotifyId } from "@/lib/spotify-ids"
import { ensureArtist, type ArtistsSupabaseClient } from "@/lib/artists"
import { resolveArtistExternalIds } from "@/lib/music-provider/musicbrainz"

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

/**
 * Exact-name lookup against the folded `artists` table → the artist's internal
 * uuid id and image, or null. `name_lower` is NOT unique (two distinct artists
 * can share a name), so an ambiguous hit (>1 row) is treated as a miss — we
 * can't safely pick one, and the MusicBrainz/mbid path disambiguates instead.
 */
async function resolveFromCache(name: string): Promise<{ id: string; imageUrl: string | null } | null> {
  try {
    const supabase = createServiceClient()
    const { data, error } = await supabase
      .from("artists")
      .select("id, image_url")
      .eq("name_lower", name.toLowerCase())
      .limit(2)
    if (error || !data || data.length !== 1) return null
    const row = data[0]
    return { id: row.id, imageUrl: row.image_url ?? null }
  } catch {
    return null
  }
}

/**
 * Resolve a Last.fm-sourced onboarding suggestion to our internal artist uuid,
 * so a seed can persist (`artist_id` is the load-bearing key post Stage-2).
 * Tries the folded `artists` table by exact name first; on a miss, falls back
 * to MusicBrainz url-rels by mbid → a Spotify id, which we then MINT into an
 * `artists` row to obtain its uuid. Returns 404 when neither yields an id — the
 * client blocks that selection. The returned `id` is a uuid the client relays
 * to the seed routes. Makes ZERO Spotify calls.
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

  // 1. Folded `artists` table by exact name → our internal uuid + image.
  const cached = await resolveFromCache(name)
  if (cached) {
    return Response.json({ id: cached.id, name, imageUrl: cached.imageUrl })
  }

  // 2. MusicBrainz url-rels by mbid (keyless; 1-req/s limited internally).
  //    The url-rel yields a Spotify id; mint it into `artists` to get a uuid.
  if (mbid) {
    const { spotifyId } = await resolveArtistExternalIds(mbid)
    if (spotifyId && isValidSpotifyId(spotifyId)) {
      const supabase = createServiceClient()
      const uuid = await ensureArtist(supabase as unknown as ArtistsSupabaseClient, { spotifyId, name })
      if (uuid) {
        console.log(`[onboard-resolve] mb-resolved name="${name}" mbid=${mbid} uuid=${uuid}`)
        return Response.json({ id: uuid, name, imageUrl: null })
      }
    }
  }

  console.log(`[onboard-resolve] unresolved name="${name}" mbid=${mbid ?? "-"}`)
  return apiError("Could not resolve this artist", 404)
}
