import { auth } from "@/lib/auth"
import { createServiceClient } from "@/lib/supabase/server"
import { apiError, apiUnauthorized, dbError } from "@/lib/errors"

export async function PATCH(request: Request) {
  const session = await auth()
  if (!session?.user?.id) return apiUnauthorized()

  const userId = session.user.id

  let body: { playThreshold?: number; lastfmUsername?: string; selectedGenres?: string[]; undergroundMode?: boolean }
  try {
    body = await request.json()
  } catch {
    return apiError("Invalid JSON", 400)
  }

  const update: Record<string, unknown> = {}

  if (body.playThreshold !== undefined) {
    const threshold = body.playThreshold
    if (!Number.isInteger(threshold) || threshold < 0 || threshold > 100) {
      return apiError("playThreshold must be an integer between 0 and 100", 400)
    }
    update.play_threshold = threshold
  }

  if (body.lastfmUsername !== undefined) {
    const lfmUsername = body.lastfmUsername.trim()
    if (lfmUsername && !/^[a-zA-Z][a-zA-Z0-9_-]{0,24}$/.test(lfmUsername)) {
      return apiError("Invalid Last.fm username format", 400)
    }
    update.lastfm_username = lfmUsername || null
  }

  if (body.selectedGenres !== undefined) {
    if (!Array.isArray(body.selectedGenres) || body.selectedGenres.length > 20) {
      return apiError("selectedGenres must be an array of up to 20 tags", 400)
    }
    update.selected_genres = body.selectedGenres.filter((g) => typeof g === "string" && g.length <= 80)
  }

  if (body.undergroundMode !== undefined) {
    update.underground_mode = !!body.undergroundMode
  }

  if (Object.keys(update).length === 0) {
    return apiError("No valid fields to update", 400)
  }

  const supabase = createServiceClient()
  const { error } = await supabase.from("users").update(update).eq("id", userId)

  if (error) return dbError(error, "settings/update")

  return Response.json({ success: true })
}
