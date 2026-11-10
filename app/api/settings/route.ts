import { LASTFM_USERNAME_RE, STATSFM_USERNAME_RE } from "@/lib/settings/patch-settings"
import { revalidatePath } from "next/cache"
import { createServiceClient } from "@/lib/supabase/server"
import { apiError, dbError } from "@/lib/errors"
import { isMusicPlatform } from "@/lib/music-links"
import { onTasteChanged } from "@/lib/taste-change"
import { encryptUsername } from "@/lib/crypto/username"
import { withAuthedJsonRoute } from "@/lib/api/with-authed-route"
import { isFameLevel } from "@/lib/settings/fame"

/**
 * Settings retired by #205 (fame_level + Wander farther replace them). A
 * patch carrying any of them is rejected whole, so a stale client finds out
 * instead of silently saving nothing.
 */
const RETIRED_KEYS = ["playThreshold", "popularityCurve", "undergroundMode", "deepDiscovery"] as const

export const PATCH = withAuthedJsonRoute(async ({ userId, body: rawBody }) => {
  const body = rawBody as {
    fameLevel?: number
    lastfmUsername?: string
    statsfmUsername?: string
    selectedGenres?: string[]
    adventurous?: boolean
    preferredMusicPlatform?: string
    onboardingCompleted?: boolean
  }

  const update: Record<string, unknown> = {}

  const retired = RETIRED_KEYS.find((k) => (body as Record<string, unknown>)[k] !== undefined)
  if (retired) return apiError(`${retired} is no longer a setting`, 400)

  if (body.fameLevel !== undefined) {
    if (!isFameLevel(body.fameLevel)) return apiError("fameLevel must be an integer between 0 and 4", 400)
    update.fame_level = body.fameLevel
  }

  if (body.lastfmUsername !== undefined) {
    if (typeof body.lastfmUsername !== "string") return apiError("Invalid Last.fm username format", 400)
    const lfmUsername = body.lastfmUsername.trim()
    if (lfmUsername && !LASTFM_USERNAME_RE.test(lfmUsername)) {
      return apiError("Invalid Last.fm username format", 400)
    }
    update.lastfm_username = encryptUsername(lfmUsername || null)
  }

  if (body.statsfmUsername !== undefined) {
    if (typeof body.statsfmUsername !== "string") return apiError("Invalid stats.fm username format", 400)
    const sfmUsername = body.statsfmUsername.trim()
    if (sfmUsername && !STATSFM_USERNAME_RE.test(sfmUsername)) {
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

  if (body.adventurous !== undefined) {
    if (typeof body.adventurous !== "boolean") return apiError("adventurous must be a boolean", 400)
    update.adventurous = body.adventurous
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

  // Settings the Feed queue derives from wipe its unseen rows so the next
  // load regenerates under the new settings (lib/taste-change).
  await onTasteChanged(supabase, userId, {
    kind: "settings",
    fields: Object.keys(body).filter((k) => body[k as keyof typeof body] !== undefined),
  })

  return Response.json({ success: true })
})
