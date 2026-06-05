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
  // Length cap matches /api/onboarding/search and /api/open — bounds the
  // string forwarded to the iTunes search URL.
  if (artistName && artistName.length > 200) {
    return apiError("Artist name too long", 400)
  }

  const supabase = createServiceClient()

  // Read exclusively from artist_tracks_cache — never call Spotify or iTunes.
  const { data: cached, error } = await supabase
    .from("artist_tracks_cache")
    .select("tracks, source, fetched_at")
    .eq("spotify_artist_id", artistId)
    .maybeSingle()

  if (error) {
    console.error(`[tracks] db-err artistId=${artistId} err=${error.message}`)
    return apiError("Failed to load tracks", 500)
  }

  const isMissing = !cached
  const age = cached ? (Date.now() - new Date(cached.fetched_at as string).getTime()) : 0
  const isStale = age >= CACHE_TTL_MS

  if (isMissing || isStale) {
    if (artistName) {
      try {
        const liveTracks = await searchTracksByArtist(artistName, "US", 5)
        if (liveTracks && liveTracks.length > 0) {
          // Shared-cache poisoning guard: artist_tracks_cache is keyed only by
          // spotify_artist_id, so a request supplying a ?name= that doesn't
          // belong to this artistId could store the wrong artist's tracks for
          // everyone. Cross-check the supplied name against the canonical name
          // for this id in artist_search_cache. If a canonical name exists and
          // disagrees, serve the live tracks to this caller but skip the
          // shared write so other users aren't contaminated.
          const { data: canonical } = await supabase
            .from("artist_search_cache")
            .select("artist_name")
            .eq("spotify_artist_id", artistId)
            .maybeSingle()

          const namesMatch =
            !canonical?.artist_name ||
            canonical.artist_name.toLowerCase().trim() === artistName.toLowerCase().trim()

          if (namesMatch) {
            await supabase.from("artist_tracks_cache").upsert(
              {
                spotify_artist_id: artistId,
                tracks: liveTracks,
                source: "itunes",
                fetched_at: new Date().toISOString(),
              },
              { onConflict: "spotify_artist_id" }
            )
          } else {
            console.warn(
              `[tracks] name/id mismatch — skipping shared cache write artistId=${artistId} suppliedName="${artistName}" canonical="${canonical?.artist_name}"`
            )
          }
          return Response.json({ tracks: liveTracks })
        }
      } catch (err) {
        console.error(`[tracks] API fallback failed:`, err)
      }
    }

    // Nothing retrieved
    return Response.json({ tracks: [], cache_miss: true })
  }

  const tracks = (cached.tracks ?? []) as Track[]
  return Response.json({ tracks })
}
