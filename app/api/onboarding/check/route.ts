import { type NextRequest } from "next/server"
import { auth } from "@/lib/auth"
import { apiUnauthorized } from "@/lib/errors"
import { musicProvider } from "@/lib/music-provider/provider"

export async function GET(_req: NextRequest) {
  const session = await auth()
  if (!session?.user?.accessToken) {
    return apiUnauthorized()
  }

  const artists = await musicProvider.getTopArtists(
    session.user.accessToken,
    "short_term"
  )

  const topArtistCount = artists.length
  const needsOnboarding = topArtistCount < 5

  return Response.json({ needsOnboarding, topArtistCount })
}
