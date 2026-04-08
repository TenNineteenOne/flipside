import { type NextRequest } from "next/server"
import { auth } from "@/lib/auth"
import { getAccessToken } from "@/lib/get-access-token"
import { musicProvider } from "@/lib/music-provider/provider"
import { createServiceClient } from "@/lib/supabase/server"
import { getOrFetchUserMarket } from "@/lib/recommendation/user-market"
import { searchTracksByArtist } from "@/lib/music-provider/itunes"
import { apiError, apiUnauthorized } from "@/lib/errors"
import { isValidSpotifyId } from "@/lib/spotify-ids"
import type { Track } from "@/lib/music-provider/types"

// 30 days — tracks lists don't change often.
const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  const session = await auth()
  const spotifyId = session?.user?.spotifyId ?? null
  if (!spotifyId) return apiUnauthorized()

  const { id: artistId } = await params
  if (!isValidSpotifyId(artistId)) return apiError("Invalid artist ID", 400)

  const supabase = createServiceClient()

  // ── 1. Cache lookup ──────────────────────────────────────────────────────
  const { data: cached } = await supabase
    .from("artist_tracks_cache")
    .select("tracks, source, fetched_at")
    .eq("spotify_artist_id", artistId)
    .maybeSingle()

  if (cached) {
    const age = Date.now() - new Date(cached.fetched_at as string).getTime()
    if (age < CACHE_TTL_MS) {
      const tracks = (cached.tracks ?? []) as Track[]
      console.log(`[tracks] cache-hit artistId=${artistId} source=${cached.source} count=${tracks.length}`)
      return Response.json({ tracks })
    }
  }

  // ── 2. Resolve artist name (from any user's recommendation_cache row) ────
  const { data: recRow } = await supabase
    .from("recommendation_cache")
    .select("artist_data")
    .eq("spotify_artist_id", artistId)
    .limit(1)
    .maybeSingle()

  const artistName =
    (recRow?.artist_data as { name?: string } | null)?.name ?? null

  if (!artistName) {
    console.log(`[tracks] no-artist-name artistId=${artistId}`)
    return Response.json({ tracks: [] })
  }

  // ── 3. Resolve market (for iTunes region) ───────────────────────────────
  const accessToken = await getAccessToken(req)
  let market = "US"
  try {
    if (accessToken) {
      market = await getOrFetchUserMarket(spotifyId, {
        readMarket: async (sid) => {
          const { data } = await supabase
            .from("users")
            .select("market")
            .eq("spotify_id", sid)
            .maybeSingle()
          return (data?.market as string | null | undefined) ?? null
        },
        writeMarket: async (sid, m) => {
          await supabase.from("users").update({ market: m }).eq("spotify_id", sid)
        },
        fetchMarket: () => musicProvider.getUserMarket(accessToken),
      })
    }
  } catch (err) {
    console.log(`[tracks] market-fail artistId=${artistId} err=${err instanceof Error ? err.message : String(err)}`)
  }

  // ── 4. Try iTunes first ──────────────────────────────────────────────────
  const itunesTracks = await searchTracksByArtist(artistName, market, 5)
  if (itunesTracks && itunesTracks.length > 0) {
    await supabase.from("artist_tracks_cache").upsert(
      {
        spotify_artist_id: artistId,
        tracks: itunesTracks,
        source: "itunes",
        fetched_at: new Date().toISOString(),
      },
      { onConflict: "spotify_artist_id" }
    )
    console.log(`[tracks] itunes-ok artistId=${artistId} count=${itunesTracks.length}`)
    return Response.json({ tracks: itunesTracks })
  }

  // ── 5. Fall back to Spotify (existing behaviour) ────────────────────────
  if (accessToken) {
    try {
      const spotifyTracks = await musicProvider.getArtistTopTracks(
        accessToken,
        artistId,
        5,
        market
      )
      if (spotifyTracks.length > 0) {
        await supabase.from("artist_tracks_cache").upsert(
          {
            spotify_artist_id: artistId,
            tracks: spotifyTracks,
            source: "spotify",
            fetched_at: new Date().toISOString(),
          },
          { onConflict: "spotify_artist_id" }
        )
        console.log(`[tracks] spotify-ok artistId=${artistId} count=${spotifyTracks.length}`)
        return Response.json({ tracks: spotifyTracks })
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.log(`[tracks] spotify-fallback-fail artistId=${artistId} err="${msg}"`)
    }
  }

  // ── 6. Graceful degradation: return empty, let the card hide gracefully ──
  console.log(`[tracks] empty artistId=${artistId} artistName="${artistName}"`)
  return Response.json({ tracks: [] })
}
