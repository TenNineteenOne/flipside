import { type NextRequest } from "next/server"
import { auth } from "@/lib/auth"
import { createServiceClient } from "@/lib/supabase/server"
import { apiError, apiUnauthorized } from "@/lib/errors"
import { isValidSpotifyId } from "@/lib/spotify-ids"
import type { Track } from "@/lib/music-provider/types"

// 24 hours — kept in sync with the pre-warming TTL in the generate route.
const CACHE_TTL_MS = 24 * 60 * 60 * 1000

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  const session = await auth()
  if (!session?.user?.spotifyId) return apiUnauthorized()

  const { id: artistId } = await params
  if (!isValidSpotifyId(artistId)) return apiError("Invalid artist ID", 400)

  const supabase = createServiceClient()

  // Read exclusively from artist_tracks_cache — never call Spotify or iTunes.
  const { data: cached, error } = await supabase
    .from("artist_tracks_cache")
    .select("tracks, source, fetched_at")
    .eq("spotify_artist_id", artistId)
    .maybeSingle()

  if (error) {
    console.log(`[tracks] db-err artistId=${artistId} err=${error.message}`)
    return apiError("Failed to load tracks", 500)
  }

  if (!cached) {
    // Pre-warming should have populated this; missing means an unusual code path.
    console.log(`[tracks] cache-miss artistId=${artistId}`)
    return Response.json({ tracks: [], cache_miss: true })
  }

  const age = Date.now() - new Date(cached.fetched_at as string).getTime()
  if (age >= CACHE_TTL_MS) {
    // Stale entry — report as a miss so the caller can decide what to do.
    // Pre-warming on the next generation cycle will refresh this.
    console.log(`[tracks] cache-stale artistId=${artistId} source=${cached.source} ageMs=${age}`)
    return Response.json({ tracks: [], cache_miss: true })
  }

  const tracks = (cached.tracks ?? []) as Track[]
  console.log(`[tracks] cache-hit artistId=${artistId} source=${cached.source} count=${tracks.length}`)
  return Response.json({ tracks })
}
