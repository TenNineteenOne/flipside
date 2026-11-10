import { getSpotifyClientToken } from "@/lib/spotify-client-token"
import type { BuildRailsInput } from "@/lib/recommendation/explore-engine"
import type { createServiceClient } from "@/lib/supabase/server"

type SupabaseClient = ReturnType<typeof createServiceClient>

/** The `users` columns the Explore engine reads. */
export const EXPLORE_USER_COLUMNS = "id, adventurous, underground_mode, popularity_curve, play_threshold"

export interface ExploreUserRow {
  id: string
  adventurous?: boolean | null
  underground_mode?: boolean | null
  popularity_curve?: unknown
  play_threshold?: unknown
}

/**
 * Map a `users` row to the Explore engine input. NULL booleans become false;
 * non-numeric curve/threshold become undefined so the engine applies its own
 * defaults (Explore deliberately does NOT use the Feed's 0.95 / 5 defaults).
 */
export function exploreInputFromRow(user: ExploreUserRow, accessToken: string): BuildRailsInput {
  return {
    userId: user.id,
    accessToken,
    adventurous: user.adventurous ?? false,
    undergroundMode: user.underground_mode ?? false,
    popularityCurve: typeof user.popularity_curve === "number" ? user.popularity_curve : undefined,
    playThreshold: typeof user.play_threshold === "number" ? user.play_threshold : undefined,
  }
}

/** Spotify token for Explore: the client-credentials token, or "" (Spotify-free). */
export async function exploreAccessToken(): Promise<string> {
  return (await getSpotifyClientToken()) ?? ""
}

/**
 * Load the Explore engine input for a user. Returns null when the row is
 * missing OR the read errored — every API caller maps both to its 404.
 */
export async function loadExploreInput(
  supabase: SupabaseClient,
  userId: string,
): Promise<BuildRailsInput | null> {
  const [{ data: user, error }, accessToken] = await Promise.all([
    supabase.from("users").select(EXPLORE_USER_COLUMNS).eq("id", userId).maybeSingle(),
    exploreAccessToken(),
  ])
  if (error || !user) return null
  return exploreInputFromRow(user as ExploreUserRow, accessToken)
}
