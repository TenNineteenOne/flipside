import { cache } from "react"
import { createServiceClient } from "@/lib/supabase/server"

/**
 * Request-scoped user row fetcher. Multiple server components (layout, page,
 * nested server subtrees) hit this on the same render pass; React.cache()
 * dedupes the Supabase call so the user row is only fetched once per request.
 *
 * Selects the full row because different callers need different subsets. The
 * row is small (~20 columns, mostly flags + short strings) so the extra
 * bandwidth is negligible compared to the saved round-trips.
 *
 * Returns `null` when the row is missing (new sign-in race, deleted account).
 * Callers should handle null the same way they would a missing row.
 */
export const getCachedUser = cache(async (userId: string) => {
  const supabase = createServiceClient()
  const { data, error } = await supabase
    .from("users")
    .select("*")
    .eq("id", userId)
    .maybeSingle()
  if (error) {
    console.error(`[user-cache] lookup err userId=${userId} err="${error.message}"`)
    throw error
  }
  return data
})
