import { auth } from "@/lib/auth"
import { createServiceClient } from "@/lib/supabase/server"
import { apiError, apiUnauthorized } from "@/lib/errors"

export async function GET(): Promise<Response> {
  const session = await auth()
  if (!session?.user?.spotifyId) return apiUnauthorized()

  const supabase = createServiceClient()

  const { data: user } = await supabase
    .from("users")
    .select("id")
    .eq("spotify_id", session.user.spotifyId)
    .maybeSingle()

  if (!user) return apiError("User not found", 404)

  const now = new Date().toISOString()

  const { data, error } = await supabase
    .from("recommendation_cache")
    .select("spotify_artist_id, artist_data, score, why, source, seen_at")
    .eq("user_id", user.id)
    .is("seen_at", null)
    .gt("expires_at", now)
    .order("score", { ascending: false })
    .limit(20)

  if (error) return apiError(error.message)

  // Auto-trigger generation if cache is empty
  if (!data || data.length === 0) {
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? ""
    void fetch(`${baseUrl}/api/recommendations/generate`, {
      method: "POST",
      headers: { Cookie: "" }, // server-to-server; generation cron handles auth separately
    }).catch(() => {})
    return Response.json({ recommendations: [], generating: true })
  }

  return Response.json({ recommendations: data, generating: false })
}
