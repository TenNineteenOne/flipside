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
  storage?: Pick<Storage, "getItem" | "removeItem"> | null
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
   * recently (storage flag) → poll only. Runs at most once per session.
   */
  start(opts: { coldStart: boolean }): void
  /** Stop any live poll (unmount). */
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
  let pollDeadline = 0
  let started = false

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

  function stopPolling() {
    if (pollTimer !== null) {
      timers.clearInterval(pollTimer)
      pollTimer = null
    }
  }

  function clearRegenFlag() {
    try { deps.storage?.removeItem(EXPLORE_REGEN_AT_KEY) } catch { /* private mode */ }
  }

  /**
   * Fetch GET /api/explore/rails and swap the rails in when generatedAt has
   * advanced past `captured`. Returns true if the swap landed. Never throws —
   * network/parse errors skip the tick so the poller stays alive.
   */
  async function pollOnce(captured: string | null): Promise<boolean> {
    try {
      const res = await fetchImpl("/api/explore/rails")
      if (!res.ok) return false
      const json = (await res.json()) as { rails: RailPayload[]; generatedAt: string | null }
      if (!hasRegenCompleted(captured, json.generatedAt)) return false
      generatedAt = json.generatedAt
      set({ rails: json.rails }) // activeKey re-validated by derive()
      return true
    } catch {
      return false
    }
  }

  /**
   * Poll every POLL_INTERVAL_MS until generatedAt advances past `captured`, or
   * the ceiling hits (soft toast). Poll-only: never POSTs. Shares one timer —
   * starting a new poll stops the previous one.
   */
  function pollUntilFresh(opts: { captured: string | null; onSettle: () => void; clearRegenFlag?: boolean }) {
    stopPolling()
    pollDeadline = now() + POLL_CEILING_MS
    pollTimer = timers.setInterval(async () => {
      if (now() >= pollDeadline) {
        stopPolling()
        if (opts.clearRegenFlag) clearRegenFlag()
        opts.onSettle()
        deps.toast("Still building — refresh in a moment", { duration: 4000 })
        return
      }
      if (await pollOnce(opts.captured)) {
        stopPolling()
        if (opts.clearRegenFlag) clearRegenFlag()
        opts.onSettle()
      }
    }, POLL_INTERVAL_MS)
  }

  /** POST a forced Explore regen, then poll until the new rails swap in. */
  async function regenAndPoll(opts: { onSettle: () => void; dropThumbsUp?: boolean; clearAdvDirty?: boolean }) {
    try {
      const res = await fetchImpl("/api/explore/generate?force=true", { method: "POST" })
      if (!res.ok) throw new Error("generate failed")
    } catch {
      deps.toast.error("Couldn't start rebuild — try again")
      opts.onSettle()
      return
    }

    // Capture AFTER the POST so a cache row written before the regen started
    // isn't accepted as fresh.
    const captured = generatedAt

    if (opts.dropThumbsUp) {
      // The rail the user is on *now* — they may have switched tabs while the
      // POST was in flight (B4: this once hardcoded the first rail).
      const active = state.orderedRails.find((r) => r.railKey === state.activeKey)
      if (active) deps.dropThumbsUp(active.artists.map((a) => a.id))
    }

    if (opts.clearAdvDirty) {
      deps.clearSignals()
      set({ isAdvDirty: false })
    }

    pollUntilFresh({ captured, onSettle: opts.onSettle })
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
        await deps.persistAdventurous(!state.adventurous)
        set({ isAdvDirty: true })
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
      if (started) return
      started = true
      if (coldStart) {
        // Populate without ever having blocked the server render.
        set({ isRegenerating: true })
        void regenAndPoll({ onSettle: () => set({ isRegenerating: false }) })
        return
      }
      // Settings fired a background regen and the user navigated here before
      // it finished: poll only (no re-POST). The storage flag is the
      // cross-navigation signal.
      let flag: string | null = null
      try { flag = deps.storage?.getItem(EXPLORE_REGEN_AT_KEY) ?? null } catch { /* private mode */ }
      if (!shouldPollOnArrival(flag, now())) return
      set({ isRegenerating: true })
      pollUntilFresh({ captured: generatedAt, clearRegenFlag: true, onSettle: () => set({ isRegenerating: false }) })
    },

    dispose: stopPolling,
  }
}
