import { type NextRequest } from "next/server"
import { auth } from "@/lib/auth"
import { createServiceClient } from "@/lib/supabase/server"
import { apiError, apiUnauthorized } from "@/lib/errors"
import { isValidSpotifyId } from "@/lib/spotify-ids"
import type { Track } from "@/lib/music-provider/types"
import { searchTracksByArtist } from "@/lib/music-provider/itunes"

// 24 hours — kept in sync with the pre-warming TTL in the generate route.
const CACHE_TTL_MS = 24 * 60 * 60 * 1000

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  const session = await auth()
  if (!session?.user?.id) return apiUnauthorized()

  const { id: artistId } = await params
  if (!isValidSpotifyId(artistId)) return apiError("Invalid artist ID", 400)

  const artistName = req.nextUrl.searchParams.get("name")

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

  const isMissing = !cached
  const age = cached ? (Date.now() - new Date(cached.fetched_at as string).getTime()) : 0
  const isStale = age >= CACHE_TTL_MS

  if (isMissing || isStale) {
    if (artistName) {
      console.log(`[tracks] Cache miss! Lazy loading from iTunes API for ${artistName}...`)
      try {
        const liveTracks = await searchTracksByArtist(artistName, "US", 5)
        if (liveTracks && liveTracks.length > 0) {
          await supabase.from("artist_tracks_cache").upsert(
            {
              spotify_artist_id: artistId,
              tracks: liveTracks,
              source: "itunes",
              fetched_at: new Date().toISOString(),
            },
            { onConflict: "spotify_artist_id" }
          )
          return Response.json({ tracks: liveTracks })
        }
      } catch (err) {
        console.log(`[tracks] API fallback failed:`, err)
      }
    }

    // Nothing retrieved
    return Response.json({ tracks: [], cache_miss: true })
  }

  const tracks = (cached.tracks ?? []) as Track[]
  console.log(`[tracks] cache-hit artistId=${artistId} source=${cached.source} count=${tracks.length}`)
  return Response.json({ tracks })
}
