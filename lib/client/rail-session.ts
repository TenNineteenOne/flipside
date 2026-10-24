import type { RailKey, RailPayload } from "@/lib/cards/explore-rail-payloads"

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

/**
 * localStorage key holding the epoch ms just BEFORE an Explore regen POST
 * (Settings rebuild, Shuffle, Apply, cold start). The server stamps
 * `generated_at` at build start, after the POST arrives, so rails with
 * `generatedAt >= flag` came from that regen (#175 Y3-a). Cleared on fresh.
 */
export const EXPLORE_REGEN_AT_KEY = "explore-regen-at"

/** Delay before retrying a thrown final GET (iOS resume network blip). */
export const FINAL_GET_RETRY_MS = 1_500

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

// ---------------------------------------------------------------------------
// Ordering + active-rail rule
// ---------------------------------------------------------------------------

/** Rails with fewer picks than this are hidden so every visible tab has depth. */
export const MIN_PICKS = 5

/**
 * Adventurous rail ordering — default-off order is adjacent/wildcards/outside/leftfield.
 * When ON, flip to serendipity-first: outside/leftfield/wildcards/adjacent. The
 * server also inflates Left-field count when Adventurous is set. Rails below
 * MIN_PICKS are dropped.
 */
export function orderRails(rails: RailPayload[], adventurous: boolean): RailPayload[] {
  const order: RailKey[] = adventurous
    ? ["outside", "leftfield", "wildcards", "adjacent"]
    : ["adjacent", "wildcards", "outside", "leftfield"]
  const byKey = new Map(rails.map((r) => [r.railKey, r] as const))
  return order
    .map((k) => byKey.get(k))
    .filter((r): r is RailPayload => !!r && r.artists.length >= MIN_PICKS)
}

/**
 * THE activeKey validity rule (B5): keep `activeKey` while it names a visible
 * rail; when it drops out of the visible set (adventurous reorder/refilter or
 * a poll swap), fall back to the first visible rail. With no visible rails,
 * keep it unchanged.
 */
export function resolveActiveKey(ordered: RailPayload[], activeKey: RailKey): RailKey {
  if (ordered.length === 0) return activeKey
  return ordered.some((r) => r.railKey === activeKey) ? activeKey : ordered[0].railKey
}

// ---------------------------------------------------------------------------
// RailSession controller
// ---------------------------------------------------------------------------

export interface RailSessionState {
  rails: RailPayload[]
  adventurous: boolean
  /** Visible rails in display order (see orderRails). Identity changes only with rails/adventurous. */
  orderedRails: RailPayload[]
  activeKey: RailKey
  activeRail: RailPayload | undefined
  /** Shuffle / cold-start / settings-arrival rebuild in progress. */
  isRegenerating: boolean
  isTogglingAdv: boolean
  /** Adventurous flipped since the rails were built — offer "Rebuild rails". */
  isAdvDirty: boolean
  isApplyingAdv: boolean
}

export interface Timers {
  setInterval: (fn: () => void, ms: number) => unknown
  clearInterval: (id: unknown) => void
}

export interface RailSessionDeps {
  initialRails: RailPayload[]
  initialGeneratedAt: string | null
  initialAdventurous: boolean
  fetchImpl?: typeof fetch
  timers?: Timers
  now?: () => number
  storage?: Pick<Storage, "getItem" | "setItem" | "removeItem"> | null
  toast: { (message: string, opts?: { duration?: number }): void; error: (message: string) => void }
  /** Persist an adventurous flip (useAdventurousMode's setter). Rejects on failure. */
  persistAdventurous: (next: boolean) => Promise<void>
  /** Clear thumbs_up for these artists (shuffle drops the active rail's likes). */
  dropThumbsUp: (artistIds: string[]) => void
  /** Clear every signal (applying an Adventurous change rebuilds every rail). */
  clearSignals: () => void
}

export interface RailSession {
  getState(): RailSessionState
  subscribe(listener: () => void): () => void
  select(key: RailKey): void
  /** Sync the externally-owned adventurous value (useAdventurousMode, cross-tab). */
  setAdventurous(adventurous: boolean): void
  toggleAdventurous(): Promise<void>
  shuffle(): Promise<void>
  applyAdventurous(): Promise<void>
  /**
   * Mount: cold start → regen + poll; otherwise, if Settings fired a regen
   * recently (storage flag) → poll only. Runs once per session; a call after
   * dispose() (StrictMode / Activity remount) revives the paused poll instead.
   */
  start(opts: { coldStart: boolean }): void
  /** Stop any live poll (unmount); in-flight work bails instead of arming a poller. */
  dispose(): void
}

/**
 * Framework-free owner of the Explore rail session: the rails, the active rail
 * (sole owner of its validity — see resolveActiveKey), ordering by adventurous
 * mode, shuffle / apply-adventurous rebuilds and the poll-until-fresh swap.
 * `useRailSession` is the React adapter.
 */
export function createRailSession(deps: RailSessionDeps): RailSession {
  const fetchImpl = deps.fetchImpl ?? fetch
  const timers: Timers = deps.timers ?? {
    setInterval: (fn, ms) => setInterval(fn, ms),
    clearInterval: (id) => clearInterval(id as ReturnType<typeof setInterval>),
  }
  const now = deps.now ?? Date.now
  const listeners = new Set<() => void>()

  let generatedAt = deps.initialGeneratedAt
  let pollTimer: unknown = null
  /** The live poll. A newer poll absorbs the older one's settles (stuck-spinner fix). */
  let poll: { captured: string | null; deadline: number; settles: Array<() => void>; inFlight: boolean } | null = null
  /** Bumped per armed timer; ticks from an older generation are ignored. */
  let pollGen = 0
  let started = false
  /** Unmounted: async continuations bail. start() after dispose() revives (StrictMode / Activity). */
  let disposed = false
  /** The adventurous value the current rails were built with (isAdvDirty compares against it). */
  let appliedAdventurous = deps.initialAdventurous

  const initialOrdered = orderRails(deps.initialRails, deps.initialAdventurous)
  let state: RailSessionState = derive({
    rails: deps.initialRails,
    adventurous: deps.initialAdventurous,
    orderedRails: initialOrdered,
    activeKey: initialOrdered[0]?.railKey ?? "adjacent",
    activeRail: undefined,
    isRegenerating: false,
    isTogglingAdv: false,
    isAdvDirty: false,
    isApplyingAdv: false,
  })

  function derive(s: RailSessionState): RailSessionState {
    const activeKey = resolveActiveKey(s.orderedRails, s.activeKey)
    const activeRail = s.orderedRails.find((r) => r.railKey === activeKey) ?? s.orderedRails[0]
    return { ...s, activeKey, activeRail }
  }

  function set(patch: Partial<RailSessionState>) {
    const next = { ...state, ...patch }
    if (patch.rails !== undefined || patch.adventurous !== undefined) {
      next.orderedRails = orderRails(next.rails, next.adventurous)
    }
    state = derive(next)
    for (const l of listeners) l()
  }

  function stopTimer() {
    if (pollTimer !== null) {
      timers.clearInterval(pollTimer)
      pollTimer = null
    }
  }

  function clearRegenFlag() {
    try { deps.storage?.removeItem(EXPLORE_REGEN_AT_KEY) } catch { /* private mode */ }
  }

  /**
   * Mark a regen in flight (before its POST) so a later session — the user
   * left Explore mid-build — picks it up and polls. An existing live flag is
   * kept: its earlier t0 is the build the server is actually running.
   * Returns true when this call wrote the flag.
   */
  function markRegen(): boolean {
    try {
      if (shouldPollOnArrival(deps.storage?.getItem(EXPLORE_REGEN_AT_KEY) ?? null, now())) return false
      deps.storage?.setItem(EXPLORE_REGEN_AT_KEY, String(now()))
      return true
    } catch { return false /* private mode */ }
  }

  /**
   * Fetch GET /api/explore/rails and swap the rails in when generatedAt has
   * advanced past `captured`. Never throws: "threw" is a network/parse error
   * (the poller stays alive; the final check retries it once).
   */
  async function pollOnce(captured: string | null, gen: number): Promise<"fresh" | "stale" | "threw"> {
    try {
      const res = await fetchImpl("/api/explore/rails")
      if (!res.ok) return "stale"
      const json = (await res.json()) as { rails: RailPayload[]; generatedAt: string | null }
      if (disposed || gen !== pollGen) return "stale" // stale tick: never swap over a newer poll
      if (!hasRegenCompleted(captured, json.generatedAt)) return "stale"
      generatedAt = json.generatedAt
      set({ rails: json.rails }) // activeKey re-validated by derive()
      return "fresh"
    } catch {
      return "threw"
    }
  }

  function armTimer() {
    stopTimer()
    const gen = ++pollGen
    pollTimer = timers.setInterval(() => { void tick(gen) }, POLL_INTERVAL_MS)
  }

  /**
   * One poll tick. Skipped while a GET is in flight; results from an older
   * generation are dropped. Past the ceiling it still does one final GET (a
   * frozen background tab resumes past the deadline) and only toasts when
   * that GET isn't fresh either.
   */
  async function tick(gen: number) {
    const p = poll
    if (disposed || gen !== pollGen || !p || p.inFlight) return
    p.inFlight = true
    const finalCheck = now() >= p.deadline
    let result = await pollOnce(p.captured, gen)
    if (finalCheck && result === "threw" && !disposed && gen === pollGen) {
      // The one final GET hit a resume network blip: retry once, not "Still building".
      await new Promise((r) => setTimeout(r, FINAL_GET_RETRY_MS))
      if (!disposed && gen === pollGen) result = await pollOnce(p.captured, gen)
    }
    const fresh = result === "fresh"
    p.inFlight = false
    if (disposed || gen !== pollGen) return
    if (!fresh && !finalCheck) return
    stopTimer()
    poll = null
    for (const settle of p.settles) settle()
    if (!fresh) deps.toast("Still building — refresh in a moment", { duration: 4000 })
  }

  /**
   * Poll every POLL_INTERVAL_MS until generatedAt advances past `captured`, or
   * the ceiling hits (soft toast). Poll-only: never POSTs. Shares one timer —
   * a new poll replaces the previous one and inherits its pending settles, so
   * every started rebuild clears its own flag when the latest one lands.
   */
  function pollUntilFresh(opts: { captured: string | null; onSettle: () => void }) {
    poll = {
      captured: opts.captured,
      deadline: now() + POLL_CEILING_MS,
      settles: [...(poll?.settles ?? []), opts.onSettle],
      inFlight: false,
    }
    armTimer()
  }

  /**
   * POST a forced Explore regen, then poll until the new rails swap in. A 429
   * is the server's cooldown: a build is already running (a Settings rebuild,
   * or a Shuffle from a previous visit) — poll for it like a success.
   */
  async function regenAndPoll(opts: { onSettle: () => void; dropThumbsUp?: boolean; clearAdvDirty?: boolean }) {
    const wroteFlag = markRegen()
    try {
      const res = await fetchImpl("/api/explore/generate?force=true", { method: "POST" })
      if (!res.ok && res.status !== 429) throw new Error("generate failed")
    } catch {
      if (wroteFlag) clearRegenFlag()
      if (disposed) return
      deps.toast.error("Couldn't start rebuild — try again")
      opts.onSettle()
      return
    }
    if (disposed) return // unmounted mid-POST: no orphan poller (the flag lets the next session poll)
    appliedAdventurous = state.adventurous // the regen builds with the current setting

    // Capture AFTER the POST so a cache row written before the regen started
    // isn't accepted as fresh.
    const captured = generatedAt

    if (opts.dropThumbsUp) {
      // The rail the user is on *now* — they may have switched tabs while the
      // POST was in flight (B4: this once hardcoded the first rail).
      const active = state.orderedRails.find((r) => r.railKey === state.activeKey)
      if (active) deps.dropThumbsUp(active.artists.map((a) => a.id))
    }

    if (opts.clearAdvDirty) deps.clearSignals()
    set({ isAdvDirty: false }) // appliedAdventurous === state.adventurous now (Shuffle too)

    pollUntilFresh({
      captured,
      onSettle: () => {
        clearRegenFlag()
        opts.onSettle()
      },
    })
  }

  return {
    getState: () => state,

    subscribe(listener) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },

    select(key) {
      set({ activeKey: key })
    },

    setAdventurous(adventurous) {
      if (adventurous !== state.adventurous) set({ adventurous })
    },

    async toggleAdventurous() {
      if (state.isTogglingAdv) return
      set({ isTogglingAdv: true })
      try {
        const next = !state.adventurous
        await deps.persistAdventurous(next)
        set({ isAdvDirty: next !== appliedAdventurous })
      } catch {
        deps.toast.error("Couldn't toggle — try again")
      } finally {
        set({ isTogglingAdv: false })
      }
    },

    async shuffle() {
      if (state.isRegenerating) return
      set({ isRegenerating: true })
      await regenAndPoll({ dropThumbsUp: true, onSettle: () => set({ isRegenerating: false }) })
    },

    async applyAdventurous() {
      if (!state.isAdvDirty || state.isApplyingAdv) return
      set({ isApplyingAdv: true })
      await regenAndPoll({ clearAdvDirty: true, onSettle: () => set({ isApplyingAdv: false }) })
    },

    start({ coldStart }) {
      if (started) {
        // StrictMode/Activity remount reuses this session: revive the poll
        // dispose() paused. Production mounts never reach here.
        if (disposed) {
          disposed = false
          if (poll) armTimer()
        }
        return
      }
      started = true
      if (coldStart) {
        // Populate without ever having blocked the server render.
        set({ isRegenerating: true })
        void regenAndPoll({ onSettle: () => set({ isRegenerating: false }) })
        return
      }
      // Settings (or a Shuffle/Apply on a previous visit) fired a background
      // regen and the user navigated here before it finished: poll only (no
      // re-POST). The storage flag is the cross-navigation signal.
      let flag: string | null = null
      try { flag = deps.storage?.getItem(EXPLORE_REGEN_AT_KEY) ?? null } catch { /* private mode */ }
      if (!shouldPollOnArrival(flag, now())) return
      if (generatedAt !== null && new Date(generatedAt).getTime() >= Number(flag)) {
        // The server already rendered the rails that regen produced.
        clearRegenFlag()
        return
      }
      set({ isRegenerating: true })
      pollUntilFresh({
        captured: generatedAt,
        onSettle: () => {
          clearRegenFlag()
          set({ isRegenerating: false })
        },
      })
    },

    dispose() {
      disposed = true
      stopTimer() // `poll` is kept so a revive (start after dispose) can re-arm it
    },
  }
}
