import { type NextRequest } from "next/server"
import { auth } from "@/lib/auth"
import { apiError, apiUnauthorized } from "@/lib/errors"
import { getSpotifyClientToken } from "@/lib/spotify-client-token"
import { musicProvider } from "@/lib/music-provider/provider"

// Artist search during onboarding uses server-side client credentials (no user OAuth needed)
export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return apiUnauthorized()

  const query = req.nextUrl.searchParams.get("q")
  if (!query || query.trim().length === 0) {
    return apiError("Query parameter 'q' is required", 400)
  }

  const accessToken = await getSpotifyClientToken()
  if (!accessToken) return apiError("Spotify unavailable", 503)

  const result = await musicProvider.searchArtists(accessToken, query.trim())

  if (!Array.isArray(result)) {
    console.log(`[onboard-search] 429 query="${query.trim()}" retry-after=${result.retryAfterSec}s`)
    return apiError("Rate limited, try again in a moment", 429)
  }

  return Response.json({ artists: result })
}
