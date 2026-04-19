import { auth } from "@/lib/auth"
import { createServiceClient } from "@/lib/supabase/server"
import { apiError, apiUnauthorized, dbError } from "@/lib/errors"
import { isValidSpotifyId } from "@/lib/spotify-ids"

export async function POST(request: Request): Promise<Response> {
  const session = await auth()
  if (!session?.user?.id) return apiUnauthorized()

  const userId = session.user.id

  let body: { spotifyArtistId?: string; signal?: string }
  try {
    body = await request.json()
  } catch {
    return apiError("Invalid JSON", 400)
  }

  const { spotifyArtistId, signal } = body
  if (!spotifyArtistId || !isValidSpotifyId(spotifyArtistId))
    return apiError("Valid spotifyArtistId is required", 400)
  if (signal !== "thumbs_up" && signal !== "thumbs_down" && signal !== "skip")
    return apiError("signal must be thumbs_up, thumbs_down, or skip", 400)

  console.log(`[feedback] ${signal} artistId=${spotifyArtistId}`)

  const supabase = createServiceClient()

  const { error: rpcError } = await supabase.rpc("rpc_record_feedback", {
    p_user_id: userId,
    p_artist_id: spotifyArtistId,
    p_signal: signal,
  })

  if (rpcError) return dbError(rpcError, "feedback/rpc")

  return Response.json({ success: true })
}
