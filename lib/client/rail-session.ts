// ---------------------------------------------------------------------------
// Poll-swap helpers — pure functions, exported for unit tests
// ---------------------------------------------------------------------------

/** True when `latest` is strictly after `captured`, meaning the regen landed. */
export function hasRegenCompleted(
  captured: string | null,
  latest: string | null,
): boolean {
  if (latest === null) return false
  if (captured === null) return true // first paint was cold; any value is new
  return new Date(latest) > new Date(captured)
}

/**
 * The ceiling (ms) after which the poller gives up and shows a soft toast.
 * Regen takes 54-74s; 90s ceiling gives comfortable headroom.
 */
export const POLL_CEILING_MS = 90_000

/** Polling cadence (ms). */
export const POLL_INTERVAL_MS = 2_500

/**
 * How long (ms) after Settings fires explore-regen-at we treat a background
 * regen as potentially still in flight. 120s gives generous headroom over the
 * 54-74s regen window.
 */
export const SETTINGS_REGEN_WINDOW_MS = 120_000

/** localStorage key written by Settings when a background explore regen fires. */
export const EXPLORE_REGEN_AT_KEY = "explore-regen-at"

/**
 * Pure helper — true when the stored flag value indicates a background explore
 * regen is likely still in flight relative to `now`.
 *
 * @param flagValue - raw string value from localStorage (or null if absent)
 * @param now       - current epoch ms (Date.now())
 * @param maxAgeMs  - maximum age to treat as in-flight (default SETTINGS_REGEN_WINDOW_MS)
 */
export function shouldPollOnArrival(
  flagValue: string | null,
  now: number,
  maxAgeMs: number = SETTINGS_REGEN_WINDOW_MS,
): boolean {
  if (flagValue === null) return false
  const ts = Number(flagValue)
  if (!Number.isFinite(ts)) return false
  return now - ts <= maxAgeMs
}
