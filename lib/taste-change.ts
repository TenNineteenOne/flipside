import { invalidateExploreCache, type RailKey } from "@/lib/recommendation/explore-engine"
import type { createServiceClient } from "@/lib/supabase/server"

type SupabaseClient = ReturnType<typeof createServiceClient>

/**
 * Something the user did that changes what Flipside should recommend.
 *  - feedback: thumbs up/down (POST) or un-thumb (DELETE). `railKey` set when
 *    the thumb came from a specific Explore rail. `skip` is NOT a taste change.
 *  - save:     save or unsave an artist.
 *  - undismiss: clear a skip/dismiss.
 *  - seeds:    add or remove seed artists.
 *  - settings: a settings PATCH; `fields` are the body keys that were sent.
 */
export type TasteChange =
  | { kind: "feedback"; railKey?: RailKey }
  | { kind: "save" }
  | { kind: "undismiss" }
  | { kind: "seeds" }
  | { kind: "settings"; fields: readonly string[] }

export interface Invalidation {
  /** Explore rails to drop: "all", a subset, or none. */
  explore: "all" | RailKey[] | null
  /** Wipe the user's unseen Feed queue (recommendation_cache, seen_at IS NULL). */
  feed: boolean
}

// Settings that both Explore rails and the Feed queue are built from.
const FEED_AND_EXPLORE_SETTINGS = ["selectedGenres", "adventurous", "undergroundMode", "deepDiscovery"]
// Settings only Explore rails depend on (explore-engine ranks rails by the curve).
const EXPLORE_ONLY_SETTINGS = ["popularityCurve"]

/** The invalidation policy: which caches a taste change makes stale. Pure. */
export function invalidationFor(change: TasteChange): Invalidation {
  switch (change.kind) {
    case "feedback":
      // Narrow to the source rail when known; other rails pick the signal up on
      // their natural 24h TTL rebuild. No rail (Feed thumbs, un-thumb) = all.
      return { explore: change.railKey ? [change.railKey] : "all", feed: false }
    case "save":
    case "undismiss":
    case "seeds":
      return { explore: "all", feed: false }
    case "settings": {
      const feed = change.fields.some((f) => FEED_AND_EXPLORE_SETTINGS.includes(f))
      const explore = feed || change.fields.some((f) => EXPLORE_ONLY_SETTINGS.includes(f))
      return { explore: explore ? "all" : null, feed }
    }
  }
}

/**
 * Apply the invalidation policy for a taste change. Never throws: failures are
 * logged and swallowed — invalidation is best-effort and must not fail the
 * write that triggered it. Awaited by callers so the serverless function
 * doesn't terminate mid-delete after the response is sent.
 */
export async function onTasteChanged(
  supabase: SupabaseClient,
  userId: string,
  change: TasteChange,
): Promise<void> {
  const { explore, feed } = invalidationFor(change)
  await Promise.all([
    explore &&
      invalidateExploreCache(userId, explore === "all" ? undefined : explore).catch((err) => {
        console.error(`[taste-change] explore-invalidate failed kind=${change.kind}`, err)
      }),
    // Reset the Explore rebuild cooldown with the rails (owner decision D5, #175):
    // a build already in flight when the taste changed writes old-settings
    // rails, and a live cooldown would pin them; cleared, the next load rebuilds.
    explore &&
      supabase
        .from("users")
        .update({ last_explore_generated_at: null })
        .eq("id", userId)
        .then(({ error }) => {
          if (error) console.error(`[taste-change] explore-cooldown-reset failed kind=${change.kind}`, error.message)
        }),
    feed &&
      supabase
        .from("recommendation_cache")
        .delete()
        .eq("user_id", userId)
        .is("seen_at", null)
        .then(({ error }) => {
          if (error) console.error(`[taste-change] feed-cache-wipe failed kind=${change.kind}`, error.message)
        }),
  ])
}
