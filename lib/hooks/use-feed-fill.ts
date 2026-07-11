"use client"

import { useCallback, useEffect, useRef } from "react"

// Minimal shape needed from the GET /api/recommendations response. Matches
// the Recommendation interface in feed-client.tsx without coupling to it.
// artist_data may have additional fields — we only care about topTracks.
export interface FeedRec {
  artist_id: string
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
  return fetched.filter((r) => !seenIds.has(r.artist_id) && isPlayable(r))
}

const POLL_INTERVAL_MS = 2500
const MAX_IDLE_POLLS = 3
const HARD_CEILING_MS = 60_000
const RESTART_TARGET_BUMP = 20

export interface FeedFillController {
  /**
   * (Re)start the poller. Clears any live interval, resets the idle counter
   * and the 60s ceiling clock, and arms a fresh interval — seenIds/shownCount
   * are NOT reset, so dedupe and progress persist across restarts. Works even
   * if the poller never auto-started (e.g. initial count was already ≥
   * targetCount).
   *
   * Design decision: a restart sets a new target of
   * `shownCount + RESTART_TARGET_BUMP`, extending past the original
   * targetCount. restart() is meant to be called right after the caller
   * explicitly asked for more (e.g. POST /api/recommendations/generate) —
   * the original target no longer reflects intent once the user has asked
   * for another batch.
   */
  restart: () => void
  /** Stop polling and clear any live interval. */
  stop: () => void
}

export interface CreateFeedFillControllerOpts<R extends FeedRec> {
  /** IDs already shown when the controller is created. */
  initialIds: string[]
  /** Stop polling once this many recs are shown (inclusive). */
  targetCount: number
  /** Called with newly-available recs to append to the feed. */
  onAppend: (recs: R[]) => void
  /** Override for testing; defaults to the global fetch. */
  fetchImpl?: typeof fetch
}

/**
 * Framework-free polling engine behind useFeedFill. Kept separate from React
 * so the polling/stop/restart logic is unit-testable without a DOM.
 *
 * Polls GET /api/recommendations every ~2500ms. On each tick, filters to
 * playable recs not already in the seen set and appends them via `onAppend`.
 *
 * Stops when:
 *   - shown count ≥ target (targetCount, or the restart()-extended target)
 *   - 3 consecutive polls added nothing new (idle)
 *   - 60s hard ceiling elapsed (measured from start, or from the last restart())
 *   - stop() is called (e.g. on unmount)
 *
 * Never throws on fetch failures — skips that tick silently.
 *
 * Auto-starts if `initialIds.length < targetCount`.
 */
export function createFeedFillController<R extends FeedRec>({
  initialIds,
  targetCount,
  onAppend,
  fetchImpl = fetch,
}: CreateFeedFillControllerOpts<R>): FeedFillController {
  const seenIds = new Set<string>(initialIds)
  let shownCount = initialIds.length
  let idleCount = 0
  let target = targetCount
  let intervalId: ReturnType<typeof setInterval> | null = null
  let startedAt = 0
  let stopped = true

  function stop() {
    if (intervalId !== null) {
      clearInterval(intervalId)
      intervalId = null
    }
    stopped = true
  }

  function start() {
    stop()
    stopped = false
    startedAt = Date.now()
    idleCount = 0

    intervalId = setInterval(async () => {
      if (stopped) return

      // Hard ceiling
      if (Date.now() - startedAt >= HARD_CEILING_MS) {
        stop()
        return
      }

      // Already reached target
      if (shownCount >= target) {
        stop()
        return
      }

      try {
        const res = await fetchImpl("/api/recommendations")
        if (!res.ok) return

        const data = (await res.json().catch(() => ({}))) as { recommendations?: R[] }
        const fetched: R[] = data.recommendations ?? []

        const newRecs = selectNewPlayable(seenIds, fetched) as R[]

        if (newRecs.length === 0) {
          idleCount += 1
          if (idleCount >= MAX_IDLE_POLLS) {
            stop()
          }
          return
        }

        // Reset idle counter on any new recs
        idleCount = 0

        for (const r of newRecs) {
          seenIds.add(r.artist_id)
        }
        shownCount += newRecs.length

        onAppend(newRecs)

        // Check target after append
        if (shownCount >= target) {
          stop()
        }
      } catch {
        // Swallow fetch/parse errors — skip this tick silently
      }
    }, POLL_INTERVAL_MS)
  }

  function restart() {
    target = shownCount + RESTART_TARGET_BUMP
    start()
  }

  if (initialIds.length < targetCount) {
    start()
  }

  return { restart, stop }
}

export interface UseFeedFillOpts<R extends FeedRec> {
  /** IDs already shown when the component mounts. */
  initialIds: string[]
  /** Stop polling once this many recs are shown (inclusive). */
  targetCount: number
  /** Called with newly-available recs to append to the feed. */
  onAppend: (recs: R[]) => void
}

export interface UseFeedFillResult {
  /** See FeedFillController.restart. */
  restart: () => void
}

/**
 * React glue around createFeedFillController: creates one controller per
 * mount (seeded from the first render's initialIds/targetCount) and tears it
 * down on unmount. See createFeedFillController for the polling/stop rules,
 * and UseFeedFillResult/restart for how to resume/extend polling after an
 * explicit user action.
 */
export function useFeedFill<R extends FeedRec>({
  initialIds,
  targetCount,
  onAppend,
}: UseFeedFillOpts<R>): UseFeedFillResult {
  const onAppendRef = useRef(onAppend)
  onAppendRef.current = onAppend

  const controllerRef = useRef<FeedFillController | null>(null)

  useEffect(() => {
    const controller = createFeedFillController<R>({
      initialIds,
      targetCount,
      onAppend: (recs) => onAppendRef.current(recs),
    })
    controllerRef.current = controller

    return () => {
      controller.stop()
      controllerRef.current = null
    }
    // Mount-only: stable initialIds/targetCount from first render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const restart = useCallback(() => {
    controllerRef.current?.restart()
  }, [])

  return { restart }
}
