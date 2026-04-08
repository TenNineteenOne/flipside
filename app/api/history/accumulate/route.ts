import { auth } from "@/lib/auth"
import { apiError, apiUnauthorized } from "@/lib/errors"
import { createServiceClient } from "@/lib/supabase/server"
import { getAccessToken } from "@/lib/get-access-token"
import {
  accumulateSpotifyHistory,
  accumulateLastFmHistory,
} from "@/lib/listened-artists"
import { type NextRequest } from "next/server"

export async function POST(req: NextRequest): Promise<Response> {
  const session = await auth()
  if (!session?.user?.spotifyId) return apiUnauthorized()

  const accessToken = await getAccessToken(req)
  if (!accessToken) return apiUnauthorized()

  const supabase = createServiceClient()

  const { data: user, error: userError } = await supabase
    .from("users")
    .select("id, lastfm_username")
    .eq("spotify_id", session.user.spotifyId)
    .maybeSingle()

  if (userError) {
    console.error("[history/accumulate] User lookup error:", userError.message)
    return apiError("Failed to load user profile")
  }

  if (!user) return apiError("User not found", 404)

  try {
    await accumulateSpotifyHistory({ userId: user.id, accessToken })

    if (user.lastfm_username) {
      await accumulateLastFmHistory({
        userId: user.id,
        lastfmUsername: user.lastfm_username,
        accessToken,
      })
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Accumulation failed"
    console.error("[history/accumulate] Error:", message)
    return apiError("History accumulation failed", 500)
  }

  return Response.json({ success: true })
}
