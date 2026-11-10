import type { createServiceClient } from "@/lib/supabase/server"

type SupabaseClient = ReturnType<typeof createServiceClient>

/**
 * Something the user did that changes what Flipside should recommend.
 *  - feedback: thumbs up/down (POST) or un-thumb (DELETE). `skip` is NOT a taste change.
 *  - save:     save or unsave an artist.
 *  - undismiss: clear a skip/dismiss.
 *  - seeds:    add or remove seed artists.
 *  - settings: a settings PATCH; `fields` are the body keys that were sent.
 *
 * Only settings the Feed queue is filtered by wipe it today; the other kinds
 * reach the next batch through the engine's normal reads. The callers stay
 * wired so a new cache only needs a rule here.
 */
export type TasteChange =
  | { kind: "feedback" }
  | { kind: "save" }
  | { kind: "undismiss" }
  | { kind: "seeds" }
  | { kind: "settings"; fields: readonly string[] }

export interface Invalidation {
  /** Wipe the user's unseen Feed queue (recommendation_cache, seen_at IS NULL). */
  feed: boolean
}

// Settings the queued Feed cards were built from. Wander farther (adventurous)
// changes the NEXT batch only, never the queued cards (#205 decision 4).
const FEED_SETTINGS = ["selectedGenres", "fameLevel"]

/** The invalidation policy: which caches a taste change makes stale. Pure. */
export function invalidationFor(change: TasteChange): Invalidation {
  if (change.kind !== "settings") return { feed: false }
  return { feed: change.fields.some((f) => FEED_SETTINGS.includes(f)) }
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
  if (!invalidationFor(change).feed) return
  const { error } = await supabase
    .from("recommendation_cache")
    .delete()
    .eq("user_id", userId)
    .is("seen_at", null)
  if (error) console.error(`[taste-change] feed-cache-wipe failed kind=${change.kind}`, error.message)
}
