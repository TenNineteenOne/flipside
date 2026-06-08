import { type NextRequest } from "next/server"
import { auth } from "@/lib/auth"
import { getAccessToken } from "@/lib/get-access-token"
import { createServiceClient } from "@/lib/supabase/server"
import { apiError, apiUnauthorized } from "@/lib/errors"
import { enforceSameOrigin } from "@/lib/csrf"
import { isValidArtistId, isValidSpotifyId } from "@/lib/spotify-ids"
import type { Track } from "@/lib/music-provider/types"

const SPOTIFY_BASE = "https://api.spotify.com/v1"

interface SpotifyTrackSearch {
  tracks?: {
    items: Array<{
      id: string
      name: string
      artists: Array<{ name: string }>
    }>
  }
}

/**
 * JIT Spotify track resolver. Looks up a track by (artistName, trackName) on
 * Spotify and returns its track ID. Writes the result back into
 * artist_tracks_cache so repeat clicks are free.
 *
 * Body: { artistId, artistName, trackName, localTrackId }
 *   - artistId is the internal artist identity (uuid); the real Spotify id is
 *     resolved from the artists table before any Spotify API call
 *   - artistId / localTrackId are used to update the cached track row
 * Returns: { spotifyTrackId: string } or 404 if not found on Spotify
 */
export async function POST(req: NextRequest): Promise<Response> {
  const blocked = enforceSameOrigin(req)
  if (blocked) return blocked
  const session = await auth()
  if (!session?.user?.id) return apiUnauthorized()

  const accessToken = await getAccessToken(req)
  if (!accessToken) return apiUnauthorized()

  let body: {
    artistId?: string
    artistName?: string
    trackName?: string
    localTrackId?: string
  }
  try {
    body = await req.json()
  } catch {
    return apiError("Invalid JSON", 400)
  }

  let { artistName, trackName } = body
  const { artistId, localTrackId } = body

  // artistId is the internal identity (uuid). Validate its format before using
  // it as a cache key / artists lookup.
  if (artistId !== undefined && !isValidArtistId(artistId)) {
    return apiError("Invalid artist ID", 400)
  }

  const supabase = createServiceClient()

  // ── [SECURITY PATCH] Validate against payload spoofing poisoning if caching occurs ──
  if (artistId && localTrackId) {
    const { data: cached } = await supabase
      .from("artist_tracks_cache")
      .select("tracks")
      .eq("artist_id", artistId)
      .maybeSingle()

    if (!cached || !cached.tracks) {
      return apiError("Invalid local cache mapping for security verification", 400)
    }

    const tracks = cached.tracks as Track[]
    const targetTrack = tracks.find(t => t.id === localTrackId)

    if (!targetTrack) {
      return apiError("Local track not verified in database bounds", 400)
    }

    // Force secure overrides derived strictly natively from DB
    trackName = targetTrack.name

    // Resolve the real Spotify id from the artists table. If the artist has no
    // Spotify mapping, skip the Spotify artist lookup gracefully — the
    // (artistName, trackName) search below still works off the cached track.
    const { data: artistRow } = await supabase
      .from("artists")
      .select("spotify_id")
      .eq("id", artistId)
      .maybeSingle()

    const spotifyId = artistRow?.spotify_id as string | null | undefined
    // Defense-in-depth: spotifyId is interpolated into a Spotify API path
    // below. Validate the resolved id's format so the safety never depends on
    // artists-table contents.
    if (spotifyId && isValidSpotifyId(spotifyId)) {
      const artistReq = await fetch(`${SPOTIFY_BASE}/artists/${spotifyId}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
        signal: AbortSignal.timeout(8000),
      })
      if (artistReq.ok) {
          const aData = await artistReq.json()
          artistName = aData.name
      }
    }
  }

  if (!artistName || !trackName) {
    return apiError("artistName and trackName required", 400)
  }
  // Length cap matches /api/onboarding/search — prevents oversized Spotify
  // query strings on the untrusted path (when no cached artistId+
  // localTrackId pair was supplied, artistName/trackName come straight from
  // the client).
  if (artistName.length > 200 || trackName.length > 200) {
    return apiError("artistName and trackName must be 200 chars or fewer", 400)
  }

  const q = `track:"${trackName}" artist:"${artistName}"`
  const url = `${SPOTIFY_BASE}/search?q=${encodeURIComponent(q)}&type=track&limit=5`

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(8000),
  })

  if (res.status === 401) return apiError("Spotify session expired", 401)
  if (res.status === 429) return apiError("Spotify rate-limited", 429)
  if (!res.ok) {
    console.error(`[resolve-track] http_${res.status} q="${q}"`)
    return apiError("Spotify search failed", 502)
  }

  const data = (await res.json()) as SpotifyTrackSearch
  const items = data.tracks?.items ?? []
  // Prefer an artist-name exact match; fall back to the first hit.
  const targetArtist = artistName.toLowerCase().trim()
  const match =
    items.find((t) =>
      (t.artists ?? []).some((a) => a.name.toLowerCase().trim() === targetArtist)
    ) ?? items[0]

  if (!match) {
    return apiError("Track not found on Spotify", 404)
  }

  const spotifyTrackId = match.id

  // ── Persist back into the cached track row, if we can locate it ─────────
  if (artistId && localTrackId) {
    // Supabase client is already instatiated above
    const { data: cached } = await supabase
      .from("artist_tracks_cache")
      .select("tracks, source")
      .eq("artist_id", artistId)
      .maybeSingle()
    if (cached?.tracks) {
      const tracks = (cached.tracks as Track[]).map((t) =>
        t.id === localTrackId ? { ...t, spotifyTrackId } : t
      )
      await supabase
        .from("artist_tracks_cache")
        .update({ tracks })
        .eq("artist_id", artistId)
    }
  }

  return Response.json({ spotifyTrackId })
}
