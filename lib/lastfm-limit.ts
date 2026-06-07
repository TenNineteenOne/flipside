/**
 * Process-wide concurrency gate for live Last.fm network calls.
 *
 * Last.fm throttles bursts: firing ~34 `tag.gettopartists` requests at once
 * (the Left-field rail's leaf-tag sample) inflated even valid calls into multi-
 * second stalls, while bounding the burst to ≤12 concurrent kept the same calls
 * under ~1s with identical results. The gate only wraps the *network* fetch —
 * cache hits never reach it, so it adds no latency on warm reads.
 *
 * Shared across the tag and similar-artist fetchers (both hit the same key /
 * rate limit) so concurrent rails and the For-You engine can't collectively
 * out-burst Last.fm.
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

/** Run `fn` under the shared Last.fm concurrency cap. */
export async function runLastfm<T>(fn: () => Promise<T>): Promise<T> {
  await acquire()
  try {
    return await fn()
  } finally {
    release()
  }
}
