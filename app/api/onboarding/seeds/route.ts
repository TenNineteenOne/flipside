import { type NextRequest } from "next/server"
import { auth } from "@/lib/auth"
import { apiError, apiUnauthorized } from "@/lib/errors"
import { isValidSpotifyId } from "@/lib/spotify-ids"
import { createServiceClient } from "@/lib/supabase/server"
import { getSpotifyClientToken } from "@/lib/spotify-client-token"

interface SpotifyArtistImage {
  url: string
  height: number
  width: number
}

interface SpotifyArtistObject {
  id: string
  name: string
  images: SpotifyArtistImage[]
}

interface SpotifyArtistsResponse {
  artists: SpotifyArtistObject[]
}

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return apiUnauthorized()

  const userId = session.user.id

  let body: { artistIds?: unknown }
  try {
    body = await req.json()
  } catch {
    return apiError("Invalid JSON body", 400)
  }

  const { artistIds } = body
  if (
    !Array.isArray(artistIds) ||
    artistIds.length < 3 ||
    artistIds.length > 5 ||
    !artistIds.every((id) => typeof id === "string" && isValidSpotifyId(id))
  ) {
    return apiError("artistIds must be an array of 3–5 valid Spotify artist IDs", 400)
  }

  const accessToken = await getSpotifyClientToken()
  if (!accessToken) return apiError("Spotify unavailable", 503)

  const spotifyRes = await fetch(
    `https://api.spotify.com/v1/artists?ids=${artistIds.join(",")}`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  )

  if (!spotifyRes.ok) {
    return apiError("Failed to fetch artist details from Spotify", 502)
  }

  const spotifyData: SpotifyArtistsResponse = await spotifyRes.json()

  const supabase = createServiceClient()

  const rows = spotifyData.artists.map((artist) => ({
    user_id: userId,
    spotify_artist_id: artist.id,
    name: artist.name,
    image_url: artist.images?.[0]?.url ?? null,
  }))

  const { error } = await supabase
    .from("seed_artists")
    .upsert(rows, { onConflict: "user_id,spotify_artist_id" })

  if (error) {
    return apiError("Failed to save seed artists", 500)
  }

  return Response.json({ success: true })
}
