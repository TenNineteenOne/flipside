import { revalidatePath } from "next/cache"
import { auth } from "@/lib/auth"
import { createServiceClient } from "@/lib/supabase/server"
import { apiError, apiUnauthorized, dbError } from "@/lib/errors"
import { enforceSameOrigin } from "@/lib/csrf"
import { isMusicPlatform } from "@/lib/music-links"
import { invalidateExploreCache } from "@/lib/recommendation/explore-engine"
import { encryptUsername } from "@/lib/crypto/username"

export async function PATCH(request: Request) {
  const blocked = enforceSameOrigin(request)
  if (blocked) return blocked
  const session = await auth()
  if (!session?.user?.id) return apiUnauthorized()

  const userId = session.user.id

  let body: {
    playThreshold?: number
    popularityCurve?: number
    lastfmUsername?: string
    statsfmUsername?: string
    selectedGenres?: string[]
    undergroundMode?: boolean
    deepDiscovery?: boolean
    adventurous?: boolean
    preferredMusicPlatform?: string
    onboardingCompleted?: boolean
  }
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

  if (body.popularityCurve !== undefined) {
    const curve = body.popularityCurve
    if (typeof curve !== "number" || !Number.isFinite(curve) || curve < 0.9 || curve > 1.0) {
      return apiError("popularityCurve must be a number between 0.9 and 1.0", 400)
    }
    // Clamp to 3 decimals to match the column definition
    update.popularity_curve = Math.round(curve * 1000) / 1000
  }

  if (body.lastfmUsername !== undefined) {
    const lfmUsername = body.lastfmUsername.trim()
    if (lfmUsername && !/^[a-zA-Z][a-zA-Z0-9_-]{0,24}$/.test(lfmUsername)) {
      return apiError("Invalid Last.fm username format", 400)
    }
    update.lastfm_username = encryptUsername(lfmUsername || null)
  }

  if (body.statsfmUsername !== undefined) {
    const sfmUsername = body.statsfmUsername.trim()
    if (sfmUsername && !/^[a-zA-Z0-9._-]{1,30}$/.test(sfmUsername)) {
      return apiError("Invalid stats.fm username format", 400)
    }
    update.statsfm_username = encryptUsername(sfmUsername || null)
  }

  if (body.selectedGenres !== undefined) {
    if (!Array.isArray(body.selectedGenres) || body.selectedGenres.length > 50) {
      return apiError("selectedGenres must be an array of up to 50 tags", 400)
    }
    update.selected_genres = body.selectedGenres.filter((g) => typeof g === "string" && g.length <= 80)
  }

  if (body.undergroundMode !== undefined) {
    update.underground_mode = !!body.undergroundMode
  }

  if (body.deepDiscovery !== undefined) {
    update.deep_discovery = !!body.deepDiscovery
  }

  if (body.adventurous !== undefined) {
    update.adventurous = !!body.adventurous
  }

  if (body.preferredMusicPlatform !== undefined) {
    if (!isMusicPlatform(body.preferredMusicPlatform)) {
      return apiError("Invalid preferredMusicPlatform", 400)
    }
    update.preferred_music_platform = body.preferredMusicPlatform
  }

  if (body.onboardingCompleted === true) {
    update.onboarding_completed_at = new Date().toISOString()
  }


  if (Object.keys(update).length === 0) {
    return apiError("No valid fields to update", 400)
  }

  const supabase = createServiceClient()
  const { error } = await supabase.from("users").update(update).eq("id", userId)

  if (error) return dbError(error, "settings/update")

  // Server Component for /settings reads users.* as initial form props; force a
  // re-render so navigating back doesn't resurrect stale toggle/slider values.
  revalidatePath("/settings")

  // Explore rails + Feed cache derive from selected_genres, adventurous,
  // underground_mode, and deep_discovery. Any of those changing invalidates
  // cached rails AND wipes unseen Feed rows so the next page load regenerates
  // from scratch under the new settings.
  const invalidates =
    body.selectedGenres !== undefined ||
    body.adventurous !== undefined ||
    body.undergroundMode !== undefined ||
    body.deepDiscovery !== undefined
  if (invalidates) {
    await Promise.all([
      invalidateExploreCache(userId).catch((err) => {
        console.error("[settings] explore-invalidate failed", err)
      }),
      supabase
        .from("recommendation_cache")
        .delete()
        .eq("user_id", userId)
        .is("seen_at", null)
        .then(({ error: delErr }) => {
          if (delErr) console.error("[settings] feed-cache-wipe failed", delErr.message)
        }),
    ])
  }

  return Response.json({ success: true })
}
