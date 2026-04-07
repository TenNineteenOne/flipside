import type { MusicProvider, Track } from "@/lib/music-provider"
import { apiError, apiUnauthorized } from "@/lib/errors"
import { isValidSpotifyId } from "@/lib/spotify-ids"

export interface TracksRequest {
  spotifyId: string | null
  accessToken: string | null
  artistId: string
}

export interface TracksDeps {
  musicProvider: Pick<MusicProvider, "getArtistTopTracks">
  /** Resolve the user's Spotify market (typically cached in DB). */
  getMarket: () => Promise<string>
}

export interface TracksResponseBody {
  tracks: Track[]
}

/**
 * Pure handler for the lazy-tracks endpoint. All inputs are explicit so
 * the handler is unit-testable without mocking next-auth, the JWT cookie,
 * or the Supabase client.
 */
export async function handleTracksRequest(
  req: TracksRequest,
  deps: TracksDeps
): Promise<Response> {
  if (!req.spotifyId || !req.accessToken) return apiUnauthorized()
  if (!isValidSpotifyId(req.artistId)) return apiError("Invalid artist ID", 400)

  let market = "US"
  try {
    market = await deps.getMarket()
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.log(`[tracks] market-fail artistId=${req.artistId} err="${msg}"`)
  }

  try {
    const tracks = await deps.musicProvider.getArtistTopTracks(
      req.accessToken,
      req.artistId,
      5,
      market
    )
    console.log(`[tracks] ok artistId=${req.artistId} count=${tracks.length}`)
    return Response.json({ tracks } satisfies TracksResponseBody)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (msg.includes("429") || msg === "rate_limited") {
      console.log(`[tracks] 429 artistId=${req.artistId}`)
      return apiError("Rate limited, try again", 429)
    }
    if (msg === "auth_expired" || msg === "http_401") {
      console.log(`[tracks] 401 artistId=${req.artistId}`)
      return apiError("Spotify session expired", 401)
    }
    console.log(`[tracks] fail artistId=${req.artistId} err="${msg}"`)
    return apiError("Failed to load tracks", 500)
  }
}
