import { cache } from "react"
import { createServiceClient } from "@/lib/supabase/server"

/**
 * Request-scoped user row fetcher. Multiple server components (layout, page,
 * nested server subtrees) hit this on the same render pass; React.cache()
 * dedupes the Supabase call so the user row is only fetched once per request.
 *
 * Selects the union of the columns its callers read ((app)/layout, the feed,
 * saved and settings pages, the onboarding layout). A new caller that needs
 * another column adds it here.
 *
 * Returns `null` when the row is missing (new sign-in race, deleted account).
 * Callers should handle null the same way they would a missing row.
 */
const USER_COLUMNS =
  "id, adventurous, onboarding_completed_at, lastfm_username, statsfm_username, preferred_music_platform, fame_level, selected_genres"

export const getCachedUser = cache(async (userId: string) => {
  const supabase = createServiceClient()
  const { data, error } = await supabase
    .from("users")
    .select(USER_COLUMNS)
    .eq("id", userId)
    .maybeSingle()
  if (error) {
    console.error(`[user-cache] lookup err userId=${userId} err="${error.message}"`)
    throw error
  }
  return data
})
