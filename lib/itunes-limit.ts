/**
 * Process-wide concurrency gate for live iTunes network calls.
 *
 * iTunes is hit from three directions simultaneously: the blocking-set preview
 * confirmation (one call per card in the initial feed), the four Explore rails
 * (each fires per-artist track lookups in parallel), and the per-artist tracks
 * endpoint used in the detail view. Without a shared gate these can fire 20-50
 * simultaneous requests, which causes iTunes to slow-lane or throttle the burst.
 * Bounding the process to ≤12 concurrent calls keeps the same work under ~1s
 * with identical results.
 *
 * The gate wraps ONLY the network fetch — cache hits (and all pure in-process
 * filtering/dedup logic) never reach it, so warm reads pay zero overhead.
 *
 * Shared across all iTunes callers so concurrent rails and the blocking set
 * can't collectively out-burst the API.
 */
const MAX_CONCURRENCY = 12

let active = 0
const waiters: Array<() => void> = []

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

/** Run `fn` under the shared iTunes concurrency cap. */
export async function runItunes<T>(fn: () => Promise<T>): Promise<T> {
  await acquire()
  try {
    return await fn()
  } finally {
    release()
  }
}
