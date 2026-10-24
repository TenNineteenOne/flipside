import type { createServiceClient } from "@/lib/supabase/server"

type SupabaseClient = ReturnType<typeof createServiceClient>

/** `users` timestamptz columns that back a per-user cooldown. */
export type CooldownColumn = "last_generated_at" | "last_explore_generated_at"

/**
 * Atomically claim a per-user cooldown window. One conditional UPDATE stamps
 * `column = now` only when it is NULL or at least `windowMs` old, so two
 * concurrent requests can't both pass the gate (the old read → check → write
 * sequence could). Claimed iff the update touched the row.
 *
 * DB errors fail OPEN ("claimed"), matching the previous gates, which ignored
 * the stamp-write result and proceeded. Callers verify the user row exists
 * first — a missing row reads as "cooling".
 */
export async function claimCooldown(
  supabase: SupabaseClient,
  userId: string,
  column: CooldownColumn,
  windowMs: number,
  now: number = Date.now(),
): Promise<"claimed" | "cooling"> {
  const cutoffIso = new Date(now - windowMs).toISOString()
  const { data, error } = await supabase
    .from("users")
    .update({ [column]: new Date(now).toISOString() })
    .eq("id", userId)
    .or(`${column}.is.null,${column}.lte.${cutoffIso}`)
    .select("id")
  if (error) {
    console.error(`[cooldown] claim err column=${column} err=${error.message}`)
    return "claimed"
  }
  return (data?.length ?? 0) > 0 ? "claimed" : "cooling"
}
