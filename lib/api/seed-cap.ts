import { apiError, dbError } from "@/lib/errors"
import type { ServiceClient } from "@/lib/api/with-authed-route"

export const MAX_SEED_ARTISTS = 200

/**
 * Total-seed cap shared by every route that adds seed artists: existing seeds
 * plus the genuinely new ids in this request must stay ≤ MAX_SEED_ARTISTS.
 * Returns the error response to send, or null when the add fits.
 */
export async function seedCapError(
  supabase: ServiceClient,
  userId: string,
  artists: ReadonlyArray<{ id: string }>,
  tag: string,
): Promise<Response | null> {
  const { data: existingRows, error } = await supabase
    .from("seed_artists")
    .select("artist_id")
    .eq("user_id", userId)

  if (error) return dbError(error, tag)

  const existingIds = new Set((existingRows ?? []).map((r) => r.artist_id))
  const newIds = artists.filter((a) => !existingIds.has(a.id))
  if (existingIds.size + newIds.length > MAX_SEED_ARTISTS) {
    return apiError(`Cannot exceed ${MAX_SEED_ARTISTS} seed artists`, 400)
  }
  return null
}
