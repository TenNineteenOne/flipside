/**
 * Process-wide concurrency gate for live iTunes network calls.
 *
 * iTunes is hit from three directions simultaneously: the blocking-set preview
 * confirmation (one call per card in the initial feed), the four Explore rails
 * (each fires per-artist track lookups in parallel), and the per-artist tracks
 * endpoint used in the detail view. Without a shared gate these can fire 20-50
 * simultaneous requests, which causes iTunes to slow-lane or throttle the burst.
 *
 * Cap reduced from 12 → 5 (issue #142) to reduce the chance of an IP-level
 * 403 during preview fan-out. A 50ms minimum gap between successive dispatches
 * spreads the burst across time instead of firing 5 back-to-back instantly.
 *
 * The gate wraps ONLY the network fetch — cache hits (and all pure in-process
 * filtering/dedup logic) never reach it, so warm reads pay zero overhead.
 *
 * Shared across all iTunes callers so concurrent rails and the blocking set
 * can't collectively out-burst the API.
 */
const MAX_CONCURRENCY = 5
const MIN_INTERVAL_MS = 50 // minimum ms between successive dispatches

let active = 0
const waiters: Array<() => void> = []

// Earliest timestamp at which the next dispatch may begin.
let earliestNextDispatch = 0

function acquire(): Promise<void> {
  if (active < MAX_CONCURRENCY) {
    active++
    return Promise.resolve()
  }
  // Slot is full — park until a releaser hands us its slot (active stays put;
  // the slot is transferred, not re-counted).
  return new Promise<void>((resolve) => waiters.push(resolve))
}

function release(): void {
  const next = waiters.shift()
  if (next) {
    next() // transfer the slot to the next waiter; active unchanged
  } else {
    active--
  }
}

/** Run `fn` under the shared iTunes concurrency cap and min-interval gate. */
export async function runItunes<T>(fn: () => Promise<T>): Promise<T> {
  // Enforce minimum gap between successive dispatches so calls are spread
  // over time rather than all 5 slots firing at once.
  const now = Date.now()
  const wait = earliestNextDispatch - now
  if (wait > 0) {
    await new Promise<void>((resolve) => setTimeout(resolve, wait))
  }
  earliestNextDispatch = Math.max(Date.now(), earliestNextDispatch) + MIN_INTERVAL_MS

  await acquire()
  try {
    return await fn()
  } finally {
    release()
  }
}
