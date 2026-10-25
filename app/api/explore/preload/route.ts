import { apiError } from "@/lib/errors"
import { withAuthedRoute } from "@/lib/api/with-authed-route"
import { loadExploreInput } from "@/lib/explore-input"
import { claimCooldown } from "@/lib/cooldown"
import { buildExploreRails, RAIL_KEYS } from "@/lib/recommendation/explore-engine"

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
 * `explore_cache`, `artists` and `artist_tracks_cache`.
 */
export const GET = withAuthedRoute(async ({ userId, supabase }): Promise<Response> => {
  const input = await loadExploreInput(supabase, userId)
  if (!input) return apiError("User not found", 404)

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

    // The claim stamps the cooldown atomically BEFORE building, so two rapid
    // preload taps (or a preload racing a Shuffle force-regen) can't both pass.
    if (isCold && (await claimCooldown(supabase, userId, "last_explore_generated_at", FORCE_COOLDOWN_MS)) === "cooling") {
      return Response.json({ ok: true })
    }

    await buildExploreRails(input, { hydrate: true })
    return Response.json({ ok: true })
  } catch (err) {
    console.error("[explore/preload] fail", err instanceof Error ? err.message : err)
    return apiError("Preload failed", 500)
  }
})
