/**
 * Shared interval-poller mechanics for the client pollers (feed fill, Explore
 * rails): fixed-rate ticks, one tick in flight at a time, a deadline with one
 * final check after it, a single retry of a thrown final check, and run-id
 * guarding so a superseded or stopped run never acts. The caller owns the
 * stop condition and side effects (`check`) and what a stop means (`onStop`).
 */

export interface Timers {
  setInterval: (fn: () => void, ms: number) => unknown
  clearInterval: (id: unknown) => void
}

/** Delay before retrying a thrown final check (iOS resume network blip). */
export const FINAL_GET_RETRY_MS = 1_500

export interface PollerOpts {
  intervalMs: number
  /**
   * One poll. Resolve true when done (the poller stops). A throw is a
   * transient miss — swallowed, except past the deadline it is retried once.
   * `isLive()` turns false once this run is stopped or superseded.
   */
  check: (isLive: () => boolean) => Promise<boolean>
  /** The run stopped itself: `done` from check, or false when the final check wasn't. */
  onStop?: (done: boolean) => void
  timers?: Timers
  now?: () => number
}

export interface Poller {
  /** Arm a fresh run (superseding any live one) that polls until `deadline`, then checks once more. */
  start(deadline: number): void
  stop(): void
}

export function createPoller({
  intervalMs,
  check,
  onStop,
  timers = { setInterval: (fn, ms) => setInterval(fn, ms), clearInterval: (id) => clearInterval(id as ReturnType<typeof setInterval>) },
  now = Date.now,
}: PollerOpts): Poller {
  let timer: unknown = null
  let runId = 0

  function stop() {
    runId++
    if (timer !== null) timers.clearInterval(timer)
    timer = null
  }

  function start(deadline: number) {
    stop()
    const run = runId
    const isLive = () => run === runId
    const attempt = () => check(isLive).catch(() => "threw" as const)
    let inFlight = false
    timer = timers.setInterval(async () => {
      if (!isLive() || inFlight) return
      inFlight = true
      // Past the deadline still poll once more: a frozen background tab (iOS)
      // resumes past the ceiling with zero polls having run.
      const finalCheck = now() >= deadline
      let result = await attempt()
      if (finalCheck && result === "threw" && isLive()) {
        await new Promise((r) => setTimeout(r, FINAL_GET_RETRY_MS))
        if (isLive()) result = await attempt()
      }
      inFlight = false
      if (!isLive() || (result !== true && !finalCheck)) return
      stop()
      onStop?.(result === true)
    }, intervalMs)
  }

  return { start, stop }
}
