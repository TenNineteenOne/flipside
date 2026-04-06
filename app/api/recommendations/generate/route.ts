import { auth } from "@/lib/auth"
import { createServiceClient } from "@/lib/supabase/server"
import { apiError, apiUnauthorized } from "@/lib/errors"
import { getAccessToken } from "@/lib/get-access-token"
import { buildRecommendations } from "@/lib/recommendation/engine"
import { type NextRequest } from "next/server"

export async function POST(req: NextRequest): Promise<Response> {
  console.log(`[generate] POST`)
  const session = await auth()
  if (!session?.user?.spotifyId) return apiUnauthorized()

  const accessToken = await getAccessToken(req)
  if (!accessToken) return apiUnauthorized()

  const supabase = createServiceClient()

  const { data: user, error: userError } = await supabase
    .from("users")
    .select("id")
    .eq("spotify_id", session.user.spotifyId)
    .maybeSingle()

  if (userError || !user) return apiError("User not found", 404)

  try {
    // Clear all unseen cache entries before regenerating
    const { error: deleteError } = await supabase
      .from("recommendation_cache")
      .delete()
      .eq("user_id", user.id)
      .is("seen_at", null)
    if (deleteError) console.log(`[generate] cache-delete err=${deleteError.message}`)

    const count = await buildRecommendations({
      userId: user.id,
      accessToken,
      spotifyId: session.user.spotifyId,
      playThreshold: 0,
    })

    return Response.json({ success: true, count })
  } catch (err) {
    console.log(`[generate] fail err=${err instanceof Error ? err.message : err}`)
    return apiError("Recommendation generation failed", 500)
  }
}
