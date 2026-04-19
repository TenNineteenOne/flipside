import { auth } from "@/lib/auth"
import { createServiceClient } from "@/lib/supabase/server"
import { apiUnauthorized, dbError } from "@/lib/errors"
import { UNDERGROUND_MAX_POPULARITY } from "@/lib/recommendation/types"

export async function GET(): Promise<Response> {
  const session = await auth()
  if (!session?.user?.id) return apiUnauthorized()

  const userId = session.user.id
  const supabase = createServiceClient()
  const now = new Date().toISOString()

  const [rowsResult, userResult] = await Promise.all([
    supabase
      .from("recommendation_cache")
      .select("spotify_artist_id, artist_data, score, why, source, seen_at")
      .eq("user_id", userId)
      .is("seen_at", null)
      .gt("expires_at", now)
      .order("score", { ascending: false })
      .limit(40),
    supabase.from("users").select("underground_mode").eq("id", userId).maybeSingle(),
  ])

  if (rowsResult.error) return dbError(rowsResult.error, "recommendations/fetch")

  // Re-filter cached rows by the user's *current* underground_mode so toggling
  // the setting takes effect without requiring an explicit regenerate.
  const undergroundMode = !!userResult.data?.underground_mode
  let recommendations = rowsResult.data ?? []
  if (undergroundMode) {
    recommendations = recommendations.filter((r) => {
      const pop = (r.artist_data as { popularity?: number } | null)?.popularity
      return typeof pop !== "number" || pop <= UNDERGROUND_MAX_POPULARITY
    })
  }
  recommendations = recommendations.slice(0, 20)

  // Return empty — client will trigger POST /api/recommendations/generate via useEffect
  return Response.json({ recommendations, generating: false })
}
