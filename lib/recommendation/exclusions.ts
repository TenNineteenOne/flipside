/**
 * Exclusions — the one "never show this artist" policy (#175 D3), shared by
 * the Feed and Explore engines. Loads the user's exclusion state once and
 * answers one question: why (if at all) is this artist excluded?
 *
 *   - thumbs_down : an active thumbs-down feedback row
 *   - listened    : the user already knows them (see `playThreshold`)
 *   - cooldown    : passive `seen_at` within 7 days, or `skip_at` set
 *                   (permanent "Dismiss"; undo lives on the History page)
 */

import type { SupabaseClient } from "@supabase/supabase-js"
import { artistNameKey } from "@/lib/artist-identity"

export type ExclusionReason = "thumbs_down" | "listened" | "cooldown"

export interface ExclusionPolicy {
  /**
   * A listened artist hides when `play_count > playThreshold` (Feed: the
   * user's play_threshold). `"any"` = any listened row hides regardless of
   * play count (Explore — owner decision #3, #175).
   */
  playThreshold: number | "any"
  /**
   * Also match listened rows that have no `artist_id` by `artistNameKey`
   * (Feed). Explore matches by id only.
   */
  nameFallback: boolean
}

export interface Exclusions {
  /** First matching reason, in order thumbs_down → listened → cooldown; null = showable. */
  reason(artist: { id: string; name: string }): ExclusionReason | null
}

const COOLDOWN_DAYS = 7
const DAY_MS = 24 * 60 * 60 * 1000

/**
 * Cooldown gate for one recommendation_cache row: a `skip_at` timestamp is a
 * permanent hide; a passive `seen_at` is a 7-day soft cooldown.
 */
export function isEligibleForCooldown(
  seenAt: string | null | undefined,
  skipAt: string | null | undefined,
  now: Date = new Date()
): boolean {
  if (skipAt) return false
  if (seenAt) {
    const days = (now.getTime() - new Date(seenAt).getTime()) / DAY_MS
    if (days < COOLDOWN_DAYS) return false
  }
  return true
}

export async function loadExclusions(
  supabase: Pick<SupabaseClient, "from">,
  userId: string,
  policy: ExclusionPolicy,
  now: Date = new Date(),
): Promise<Exclusions> {
  const cooldownStart = new Date(now.getTime() - COOLDOWN_DAYS * DAY_MS).toISOString()
  const [listened, thumbsDown, seen, skipped] = await Promise.all([
    supabase.from("listened_artists").select("artist_id, lastfm_artist_name, play_count").eq("user_id", userId),
    supabase.from("feedback").select("artist_id").eq("user_id", userId).eq("signal", "thumbs_down").is("deleted_at", null),
    supabase
      .from("recommendation_cache")
      .select("artist_id")
      .eq("user_id", userId)
      .not("seen_at", "is", null)
      .gte("seen_at", cooldownStart),
    supabase.from("recommendation_cache").select("artist_id").eq("user_id", userId).not("skip_at", "is", null),
  ])

  const listenedIds = new Set<string>()
  const listenedNames = new Set<string>()
  for (const row of listened.data ?? []) {
    if (policy.playThreshold !== "any" && (row.play_count == null || row.play_count <= policy.playThreshold)) continue
    if (row.artist_id) listenedIds.add(row.artist_id as string)
    else if (policy.nameFallback && row.lastfm_artist_name) listenedNames.add(artistNameKey(row.lastfm_artist_name as string))
  }
  const thumbsDownIds = new Set((thumbsDown.data ?? []).map((r) => r.artist_id as string))
  const cooldownIds = new Set<string>()
  for (const r of [...(seen.data ?? []), ...(skipped.data ?? [])]) cooldownIds.add(r.artist_id as string)

  return {
    reason(artist) {
      if (thumbsDownIds.has(artist.id)) return "thumbs_down"
      if (listenedIds.has(artist.id)) return "listened"
      if (listenedNames.size > 0 && listenedNames.has(artistNameKey(artist.name))) return "listened"
      if (cooldownIds.has(artist.id)) return "cooldown"
      return null
    },
  }
}
