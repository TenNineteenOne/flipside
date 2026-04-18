import { auth } from "@/lib/auth"
import { createServiceClient } from "@/lib/supabase/server"
import { apiUnauthorized, dbError } from "@/lib/errors"

export async function GET(): Promise<Response> {
  const session = await auth()
  if (!session?.user?.id) return apiUnauthorized()

  const userId = session.user.id
  const supabase = createServiceClient()
  const now = new Date().toISOString()

  const { data, error } = await supabase
    .from("recommendation_cache")
    .select("spotify_artist_id, artist_data, score, why, source, seen_at")
    .eq("user_id", userId)
    .is("seen_at", null)
    .gt("expires_at", now)
    .order("score", { ascending: false })
    .limit(20)

  if (error) return dbError(error, "recommendations/fetch")

  // Return empty — client will trigger POST /api/recommendations/generate via useEffect
  return Response.json({ recommendations: data ?? [], generating: false })
}
