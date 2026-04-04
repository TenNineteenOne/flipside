import { type NextRequest } from "next/server"
import { auth } from "@/lib/auth"
import { apiUnauthorized } from "@/lib/errors"
import { getAccessToken } from "@/lib/get-access-token"
import { musicProvider } from "@/lib/music-provider/provider"

export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.spotifyId) {
    return apiUnauthorized()
  }

  const accessToken = await getAccessToken(req)
  if (!accessToken) return apiUnauthorized()

  const artists = await musicProvider.getTopArtists(
    accessToken,
    "short_term"
  )

  const topArtistCount = artists.length
  const needsOnboarding = topArtistCount < 5

  return Response.json({ needsOnboarding, topArtistCount })
}
