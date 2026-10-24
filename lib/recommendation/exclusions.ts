/**
 * Exclusions — the one "never show this artist" policy (#175 D3), shared by
 * the Feed and Explore engines. Loads the user's exclusion state once and
 * answers one question: why (if at all) is this artist excluded?
 *
 *   - thumbs_down : an active thumbs-down feedback row
 *   - listened    : the user already knows them (see `playThreshold`)
 *   - liked       : an active thumbs-up or a save (policy `liked`, Feed only —
 *                   owner decision D1: liked/saved artists never come back)
 *   - cooldown    : passive `seen_at` within 7 days, or `skip_at` set
 *                   (permanent "Dismiss"; undo lives on the History page)
 */

import type { SupabaseClient } from "@supabase/supabase-js"
import { artistNameKey } from "@/lib/artist-identity"

export type ExclusionReason = "thumbs_down" | "listened" | "liked" | "cooldown"

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
  /**
   * Hide thumbs-up and saved artists (Feed, #175 F-B). Their cache rows carry
   * a `seen_at`, so the 7-day cooldown alone would resurface them, and once
   * the nightly cron deletes the row they'd come back as new recs.
   */
  liked?: boolean
}

export interface Exclusions {
  /** First matching reason, in order thumbs_down → listened → liked → cooldown; null = showable. */
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

type QueryRows<T> = PromiseLike<{ data: T[] | null }>

/** PostgREST's default max-rows cap; a plain select silently truncates past it. */
const PAGE_SIZE = 1000

/**
 * Read EVERY row of a per-user query, paging with `.range()` in chunks of
 * PAGE_SIZE until a short page (#175 F16 — a heavy Last.fm user easily has
 * >1000 listened rows, and a truncated read silently un-excludes the rest).
 * `page(from, to)` must build the full query (ordered by a unique column so
 * pages don't overlap) and apply `.range(from, to)`. On an error the rows read
 * so far are returned with it — callers already degrade an error to "fewer
 * exclusions".
 */
export async function readAllRows<T>(
  page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<{ data: T[]; error: { message: string } | null }> {
  const rows: T[] = []
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await page(from, from + PAGE_SIZE - 1)
    if (error) return { data: rows, error }
    rows.push(...(data ?? []))
    if ((data ?? []).length < PAGE_SIZE) return { data: rows, error: null }
  }
}

/**
 * Reads a caller already has in flight (#175 E4b: Explore's user context reads
 * the same rows). `listened` must hold every row with an `artist_id` (and
 * `lastfm_artist_name` when the policy uses `nameFallback`); `thumbsDown` the
 * user's active thumbs-down feedback — ALL rows (page with `readAllRows`).
 * Pass promises, not builders, so each read runs once however often it's awaited.
 */
export interface PreloadedRows {
  listened?: QueryRows<{ artist_id: string | null; play_count?: number | null; lastfm_artist_name?: string | null }>
  thumbsDown?: QueryRows<{ artist_id: string }>
}

export async function loadExclusions(
  supabase: Pick<SupabaseClient, "from">,
  userId: string,
  policy: ExclusionPolicy,
  now: Date = new Date(),
  preloaded: PreloadedRows = {},
): Promise<Exclusions> {
  const cooldownStart = new Date(now.getTime() - COOLDOWN_DAYS * DAY_MS).toISOString()
  const none = Promise.resolve({ data: [] as { artist_id: string }[] })
  const [listened, thumbsDown, seen, skipped, thumbsUp, saved] = await Promise.all([
    preloaded.listened ??
      readAllRows((from, to) =>
        supabase
          .from("listened_artists")
          .select("artist_id, lastfm_artist_name, play_count")
          .eq("user_id", userId)
          .order("id", { ascending: true })
          .range(from, to),
      ),
    preloaded.thumbsDown ?? readFeedbackIds(supabase, userId, "thumbs_down"),
    readAllRows((from, to) =>
      supabase
        .from("recommendation_cache")
        .select("artist_id")
        .eq("user_id", userId)
        .not("seen_at", "is", null)
        .gte("seen_at", cooldownStart)
        .order("id", { ascending: true })
        .range(from, to),
    ),
    readAllRows((from, to) =>
      supabase
        .from("recommendation_cache")
        .select("artist_id")
        .eq("user_id", userId)
        .not("skip_at", "is", null)
        .order("id", { ascending: true })
        .range(from, to),
    ),
    policy.liked ? readFeedbackIds(supabase, userId, "thumbs_up") : none,
    policy.liked
      ? readAllRows<{ artist_id: string }>((from, to) =>
          supabase
            .from("saves")
            .select("artist_id")
            .eq("user_id", userId)
            .order("id", { ascending: true })
            .range(from, to),
        )
      : none,
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
  const likedIds = new Set([...(thumbsUp.data ?? []), ...(saved.data ?? [])].map((r) => r.artist_id as string))

  return {
    reason(artist) {
      if (thumbsDownIds.has(artist.id)) return "thumbs_down"
      if (listenedIds.has(artist.id)) return "listened"
      if (listenedNames.size > 0 && listenedNames.has(artistNameKey(artist.name))) return "listened"
      if (likedIds.has(artist.id)) return "liked"
      if (cooldownIds.has(artist.id)) return "cooldown"
      return null
    },
  }
}

/** The user's active thumbs-down / thumbs-up feedback, every row (paged). */
export function readFeedbackIds(
  supabase: Pick<SupabaseClient, "from">,
  userId: string,
  signal: "thumbs_down" | "thumbs_up",
) {
  return readAllRows<{ artist_id: string }>((from, to) =>
    supabase
      .from("feedback")
      .select("artist_id")
      .eq("user_id", userId)
      .eq("signal", signal)
      .is("deleted_at", null)
      .order("id", { ascending: true })
      .range(from, to),
  )
}
