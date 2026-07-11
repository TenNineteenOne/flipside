import { safeAuth } from "@/lib/auth"
import { createServiceClient } from "@/lib/supabase/server"
import { apiError, apiUnauthorized } from "@/lib/errors"
import { getAccessToken } from "@/lib/get-access-token"
import { getSpotifyClientToken } from "@/lib/spotify-client-token"
import { buildExploreRails, RAIL_KEYS } from "@/lib/recommendation/explore-engine"
import type { NextRequest } from "next/server"

// Mirrors explore/generate's force-regen cooldown (C1 hardening): this GET
// has no `force` flag, but on a cold cache it runs the SAME 54-74s rail
// build with no gate at all, so rapid Feed<->Explore navigation (or several
// tabs) could fan out overlapping expensive builds against the shared
// Last.fm/Spotify key.
const FORCE_COOLDOWN_MS = 90_000

// Cold-cache builds run all four rails (Last.fm + Spotify/iTunes I/O) and can
// take 54-74s; give it the full Hobby/Fluid function budget (F-hardening).
export const maxDuration = 300

/**
 * Background warm for the Explore page. Triggered from the Feed page while the
 * user is viewing it, so that when they tap Explore the rails + artist cache
 * are already populated. Read-only from the client's POV — the response body
 * is just `{ ok: true }`; the value is the side-effect of populating
 * `explore_cache` and `artist_search_cache`.
 */
export async function GET(req: NextRequest): Promise<Response> {
  const session = await safeAuth()
  if (!session?.user?.id) return apiUnauthorized()

  const userId = session.user.id
  const supabase = createServiceClient()

  const [{ data: user, error: userError }, userAccessToken, clientToken] = await Promise.all([
    supabase
      .from("users")
      .select("id, adventurous, underground_mode, popularity_curve, play_threshold, last_explore_generated_at")
      .eq("id", userId)
      .maybeSingle(),
    getAccessToken(req),
    getSpotifyClientToken(),
  ])
  if (userError || !user) return apiError("User not found", 404)

  const accessToken = userAccessToken ?? clientToken ?? ""

  try {
    // Cheap warm/cold check (mirrors buildExploreRails' own cache read) so the
    // cooldown only gates the expensive cold-cache build path — a warm-cache
    // preload stays a cheap no-op read and doesn't burn the shared cooldown.
    const { data: cached } = await supabase
      .from("explore_cache")
      .select("rail_key")
      .eq("user_id", userId)
      .gt("expires_at", new Date().toISOString())
    const isCold = (cached?.length ?? 0) < RAIL_KEYS.length

    if (isCold) {
      if (user.last_explore_generated_at) {
        const elapsed = Date.now() - new Date(user.last_explore_generated_at).getTime()
        if (elapsed < FORCE_COOLDOWN_MS) {
          return Response.json({ ok: true })
        }
      }
      // Stamp the cooldown BEFORE building so two rapid preload taps (or a
      // preload racing a Shuffle force-regen) can't both pass the gate.
      await supabase
        .from("users")
        .update({ last_explore_generated_at: new Date().toISOString() })
        .eq("id", userId)
    }

    await buildExploreRails(
      {
        userId: user.id,
        accessToken,
        adventurous: user.adventurous ?? false,
        undergroundMode: user.underground_mode ?? false,
        popularityCurve: typeof user.popularity_curve === "number" ? user.popularity_curve : undefined,
        playThreshold: typeof user.play_threshold === "number" ? user.play_threshold : undefined,
      },
      { hydrate: true },
    )
    return Response.json({ ok: true })
  } catch (err) {
    console.error("[explore/preload] fail", err instanceof Error ? err.message : err)
    return apiError("Preload failed", 500)
  }
}
