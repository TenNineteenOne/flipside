import { type NextRequest } from "next/server"
import { auth } from "@/lib/auth"
import { apiError, apiUnauthorized } from "@/lib/errors"
import { musicProvider } from "@/lib/music-provider/provider"

export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.accessToken) {
    return apiUnauthorized()
  }

  const query = req.nextUrl.searchParams.get("q")
  if (!query || query.trim().length === 0) {
    return apiError("Query parameter 'q' is required", 400)
  }

  const artists = await musicProvider.searchArtists(session.user.accessToken, query.trim())

  return Response.json({ artists })
}
