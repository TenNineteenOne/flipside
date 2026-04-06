import { type NextRequest } from "next/server"
import { auth } from "@/lib/auth"
import { apiError, apiUnauthorized } from "@/lib/errors"
import { getAccessToken } from "@/lib/get-access-token"
import { musicProvider } from "@/lib/music-provider/provider"

export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.spotifyId) {
    return apiUnauthorized()
  }

  const accessToken = await getAccessToken(req)
  if (!accessToken) return apiUnauthorized()

  const query = req.nextUrl.searchParams.get("q")
  if (!query || query.trim().length === 0) {
    return apiError("Query parameter 'q' is required", 400)
  }

  const artists = await musicProvider.searchArtists(accessToken, query.trim())

  if (artists === null) {
    console.log(`[onboard-search] 429 query="${query.trim()}"`)
    return apiError("Rate limited, try again in a moment", 429)
  }

  return Response.json({ artists })
}
