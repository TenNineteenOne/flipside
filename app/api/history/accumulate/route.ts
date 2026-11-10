import { apiError } from "@/lib/errors"
import { createServiceClient } from "@/lib/supabase/server"
import { withAuthedCsrfRoute } from "@/lib/api/with-authed-route"
import { accumulateLastFmHistory } from "@/lib/history/lastfm-syncer"
import { accumulateStatsFmHistory } from "@/lib/history/statsfm-syncer"
import { decryptUsername } from "@/lib/crypto/username"
import { claimCooldown } from "@/lib/cooldown"

const COOLDOWN_MS = 15 * 60_000
type Source = "lastfm" | "statsfm"

// withAuthedCsrfRoute (not withAuthedJsonRoute): an invalid/missing body here
// falls through to the "source must be..." validation error rather than the
// wrapper's generic "Invalid JSON" — body-parsing stays local to preserve
// that exact message.
export const POST = withAuthedCsrfRoute(async ({ userId, request }): Promise<Response> => {
  let source: Source
  try {
    const body = (await request.json().catch(() => ({}))) as { source?: unknown }
    if (body.source !== "lastfm" && body.source !== "statsfm") {
      return apiError("source must be 'lastfm' or 'statsfm'", 400)
    }
    source = body.source
  } catch {
    return apiError("Invalid JSON body", 400)
  }

  const supabase = createServiceClient()

  const { data: user, error: userError } = await supabase
    .from("users")
    .select("lastfm_username, statsfm_username, last_accumulated_lastfm_at, last_accumulated_statsfm_at")
    .eq("id", userId)
    .maybeSingle()

  if (userError) {
    console.error("[history/accumulate] User lookup error:", userError.message)
    return apiError("Failed to load user profile", 500)
  }
  if (!user) return apiError("User not found", 404)

  const storedUsername = source === "lastfm" ? user.lastfm_username : user.statsfm_username
  const cooldownField = source === "lastfm" ? "last_accumulated_lastfm_at" : "last_accumulated_statsfm_at"
  const lastAt = source === "lastfm" ? user.last_accumulated_lastfm_at : user.last_accumulated_statsfm_at

  if (!storedUsername) {
    return apiError(`No ${source === "lastfm" ? "Last.fm" : "stats.fm"} account connected`, 400)
  }

  let username: string | null
  try {
    username = decryptUsername(storedUsername)
  } catch (err) {
    console.error(`[history/accumulate] ${source} decrypt failed userId=${userId} err="${err instanceof Error ? err.message : err}"`)
    return apiError(`${source === "lastfm" ? "Last.fm" : "stats.fm"} sync failed — verify your username in settings`, 500)
  }
  if (!username) {
    return apiError(`No ${source === "lastfm" ? "Last.fm" : "stats.fm"} account connected`, 400)
  }

  // Atomic claim BEFORE the sync, so a double-click can't run two syncs (and
  // double-bump play_count). A failed sync restores the previous stamp, so it
  // doesn't consume the cooldown (same semantics as the old stamp-on-success).
  if ((await claimCooldown(supabase, userId, cooldownField, COOLDOWN_MS)) === "cooling") {
    return apiError("Please wait before syncing again", 429)
  }

  try {
    if (source === "lastfm") {
      await accumulateLastFmHistory({ userId, lastfmUsername: username })
    } else {
      await accumulateStatsFmHistory({ userId, statsfmUsername: username })
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Accumulation failed"
    console.error(`[history/accumulate] ${source} error:`, message)
    const { error: restoreError } = await supabase
      .from("users")
      .update({ [cooldownField]: lastAt ?? null })
      .eq("id", userId)
    if (restoreError) console.error("[history/accumulate] Cooldown restore error:", restoreError.message)
    return apiError(`${source === "lastfm" ? "Last.fm" : "stats.fm"} sync failed`, 500)
  }

  const now = new Date().toISOString()
  const { error: updateError } = await supabase
    .from("users")
    .update({ [cooldownField]: now, last_accumulated_at: now })
    .eq("id", userId)
  if (updateError) {
    console.error("[history/accumulate] Cooldown update error:", updateError.message)
  }

  return Response.json({ success: true })
})
