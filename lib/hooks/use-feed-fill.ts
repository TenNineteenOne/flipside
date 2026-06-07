"use client"

import { useEffect, useRef } from "react"

// Minimal shape needed from the GET /api/recommendations response. Matches
// the Recommendation interface in feed-client.tsx without coupling to it.
// artist_data may have additional fields — we only care about topTracks.
export interface FeedRec {
  spotify_artist_id: string
  artist_data: ArtistDataWithTracks
}

// Structural interface: any object with an optional topTracks array satisfies
// this. ArtistWithTracks in feed-client.tsx is a structural supertype.
export interface ArtistDataWithTracks {
  topTracks?: ReadonlyArray<{ previewUrl: string | null }>
}

/**
 * Returns true if a recommendation has at least one track with a playable
 * preview URL. Mirrors the `hasPlayablePreview` check from confirm-previews.ts
 * inlined here so this module stays client-safe (no server-only deps).
 */
export function isPlayable(rec: FeedRec): boolean {
  const tracks = rec.artist_data?.topTracks
  return !!tracks && tracks.some((t) => t.previewUrl != null && t.previewUrl !== "")
}

/**
 * Pure selector: from a batch of fetched recs, return only those that are:
 *   - playable (has ≥1 track with non-empty previewUrl)
 *   - not already in seenIds
 * Returned in the same order as `fetched`.
 */
export function selectNewPlayable(seenIds: Set<string>, fetched: FeedRec[]): FeedRec[] {
  return fetched.filter((r) => !seenIds.has(r.spotify_artist_id) && isPlayable(r))
}

export interface UseFeedFillOpts<R extends FeedRec> {
  /** IDs already shown when the component mounts. */
  initialIds: string[]
  /** Stop polling once this many recs are shown (inclusive). */
  targetCount: number
  /** Called with newly-available recs to append to the feed. */
  onAppend: (recs: R[]) => void
}

const POLL_INTERVAL_MS = 2500
const MAX_IDLE_POLLS = 3
const HARD_CEILING_MS = 60_000

/**
 * Background poller that grows the feed after first paint.
 *
 * Polls GET /api/recommendations every ~2500ms. On each tick, filters to
 * playable recs not already in the seen set and appends them via `onAppend`.
 *
 * Stops when:
 *   - shown count ≥ targetCount
 *   - 3 consecutive polls added nothing new (idle)
 *   - 60s hard ceiling elapsed
 *   - component unmounts
 *
 * Never throws on fetch failures — skips that tick silently.
 */
export function useFeedFill<R extends FeedRec>({
  initialIds,
  targetCount,
  onAppend,
}: UseFeedFillOpts<R>): void {
  // Use refs for mutable state so the interval callback is always current
  // without needing to recreate the interval on each render.
  const seenIdsRef = useRef<Set<string>>(new Set(initialIds))
  const shownCountRef = useRef(initialIds.length)
  const idleCountRef = useRef(0)
  const onAppendRef = useRef(onAppend)
  onAppendRef.current = onAppend

  useEffect(() => {
    // Seed seen set from initialIds (in case they changed between renders
    // before the effect ran, though mount-only ensures stable initialIds).
    seenIdsRef.current = new Set(initialIds)
    shownCountRef.current = initialIds.length
    idleCountRef.current = 0

    // Already at target on mount — nothing to do.
    if (initialIds.length >= targetCount) return

    const startedAt = Date.now()
    let stopped = false

    const intervalId = setInterval(async () => {
      if (stopped) return

      // Hard ceiling
      if (Date.now() - startedAt >= HARD_CEILING_MS) {
        clearInterval(intervalId)
        stopped = true
        return
      }

      // Already reached target
      if (shownCountRef.current >= targetCount) {
        clearInterval(intervalId)
        stopped = true
        return
      }

      try {
        const res = await fetch("/api/recommendations")
        if (!res.ok) return

        const data = (await res.json().catch(() => ({}))) as { recommendations?: R[] }
        const fetched: R[] = data.recommendations ?? []

        const newRecs = selectNewPlayable(seenIdsRef.current, fetched) as R[]

        if (newRecs.length === 0) {
          idleCountRef.current += 1
          if (idleCountRef.current >= MAX_IDLE_POLLS) {
            clearInterval(intervalId)
            stopped = true
          }
          return
        }

        // Reset idle counter on any new recs
        idleCountRef.current = 0

        // Update seen set
        for (const r of newRecs) {
          seenIdsRef.current.add(r.spotify_artist_id)
        }
        shownCountRef.current += newRecs.length

        onAppendRef.current(newRecs)

        // Check target after append
        if (shownCountRef.current >= targetCount) {
          clearInterval(intervalId)
          stopped = true
        }
      } catch {
        // Swallow fetch/parse errors — skip this tick silently
      }
    }, POLL_INTERVAL_MS)

    return () => {
      stopped = true
      clearInterval(intervalId)
    }
    // Mount-only: stable initialIds/targetCount from first render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
}
