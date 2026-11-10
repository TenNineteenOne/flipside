"use client"

import { useEffect, useState } from "react"
import { patchSettings } from "@/lib/settings/patch-settings"

// ─── Public constants ────────────────────────────────────────────────────────
// Centralises the magic strings that were previously duplicated across four
// consumer files.  Tests can import these instead of hardcoding strings.

export const ADVENTUROUS_STORAGE_KEY = "flipside.adventurous"
export const ADVENTUROUS_EVENT_NAME = "flipside:adventurous-change"

// ─── Testable helpers (exported so tests can call them without React) ────────

/**
 * Read the adventurous flag from localStorage.
 *
 * Returns `fallback` when localStorage is unavailable (private mode) OR when
 * the key is absent. The `fallback` is **intentionally** the caller's `initial`
 * value (typically the server-rendered `users.adventurous`), NOT a hardcoded
 * `false`.
 *
 * Why this matters: an earlier nav read `getItem(...) === "1"`, which is
 * false on a missing key, so a returning adventurous user in incognito or on
 * a fresh device saw adventurous mode switch off after mount — their saved
 * preference silently dropped until they re-toggled in Settings.
 *
 * Every consumer (the app shell's adventurous line, Settings, the Feed switch)
 * treats the server as authoritative on first render. localStorage acts as a
 * write-through cache for in-tab and cross-tab sync, not as the source of
 * truth.
 */
export function readAdventurousFromStorage(fallback: boolean): boolean {
  try {
    const raw = localStorage.getItem(ADVENTUROUS_STORAGE_KEY)
    if (raw === null) return fallback
    return raw === "1"
  } catch {
    return fallback
  }
}

/**
 * Persist the adventurous flag to localStorage.
 * Silently swallows errors (private mode tolerance).
 */
export function writeAdventurousToStorage(next: boolean): void {
  try {
    localStorage.setItem(ADVENTUROUS_STORAGE_KEY, next ? "1" : "0")
  } catch {
    // noop — private browsing / blocked storage
  }
}

/**
 * Mount reconciliation: the server-rendered value is authoritative, so it
 * overwrites whatever an earlier session left in storage (a stale "0" must not
 * flip a server `true` off, or the reverse). Returns the value to show.
 */
export function adoptServerAdventurous(initial: boolean): boolean {
  const value = (confirmed ??= initial)
  writeAdventurousToStorage(value)
  return value
}

/**
 * The last value the server confirmed in this page session. It outlives client navigations
 * (Back can restore a cached Feed whose `initial` predates a toggle) and resets on a hard load,
 * so a value set on another device still wins after a reload.
 */
let confirmed: boolean | null = null
export function resetConfirmedAdventurous(): void { confirmed = null }

/**
 * The writer behind setAdventurous, React-free so it can be tested. Saves run one at a time in
 * call order; the optimistic state flips at once, so rapid clicks read the value they see. Only
 * the newest save broadcasts or rolls back (to the last confirmed value), so an older save landing
 * never flickers the switch. Rejects when its own save fails (callers toast).
 */
export function createAdventurousWriter(deps: {
  setState: (v: boolean) => void
  fallback: () => boolean
  patch?: (next: boolean) => Promise<void>
}): (next: boolean) => Promise<void> {
  const patch = deps.patch ?? patchAdventurousSetting
  let chain: Promise<void> = Promise.resolve()
  let latest = 0
  return (next) => {
    deps.setState(next)
    const id = ++latest
    const run = chain.then(() => patch(next)).then(
      () => {
        confirmed = next
        writeAdventurousToStorage(next)
        if (id === latest) dispatchAdventurousEvent()
      },
      (err) => {
        if (id === latest) deps.setState(confirmed ?? deps.fallback())
        throw err
      },
    )
    chain = run.catch(() => {})
    return run
  }
}

/**
 * Dispatch the in-tab sync event so other mounted hook instances update.
 */
export function dispatchAdventurousEvent(): void {
  window.dispatchEvent(new Event(ADVENTUROUS_EVENT_NAME))
}

/**
 * PATCH /api/settings with { adventurous: next } via patchSettings.
 * Rejects if the response is not ok (callers toast their own copy).
 */
export async function patchAdventurousSetting(next: boolean): Promise<void> {
  await patchSettings({ adventurous: next })
}

// ─── Public interface ─────────────────────────────────────────────────────────

export interface UseAdventurousModeResult {
  adventurous: boolean
  setAdventurous: (next: boolean) => Promise<void>
}

/**
 * Single seam for "is adventurous mode on?" across the app.
 *
 * Owns the localStorage + window event + PATCH pattern for every consumer:
 * the app shell (adventurous line on the rail / under the top bar), the
 * Settings discovery panel and the Feed's Wander farther switch.
 *
 * SSR-safe: the initial render uses `initial` (from the server), and on mount
 * that value is written to localStorage (server-authoritative). Storage is only
 * read for in-tab and cross-tab sync events after that.
 *
 * The hook does NOT toast on failure and does NOT call any rebuild helpers —
 * those are caller responsibilities so each surface can react differently.
 */
export function useAdventurousMode(initial: boolean): UseAdventurousModeResult {
  const [adventurous, setAdventurousState] = useState(initial)

  // ── Mount effect: adopt the server value + subscribe to sync events ──
  useEffect(() => {
    // Re-read localStorage on in-tab / cross-tab sync events.
    const syncFromStorage = () => {
      setAdventurousState(readAdventurousFromStorage(initial))
    }
    // The server value wins on mount (a changed `initial` prop re-adopts it).
    // Called as a callback (not inline) to satisfy react-hooks/set-state-in-effect.
    const adopt = () => setAdventurousState(adoptServerAdventurous(initial))
    adopt()

    const handleStorageEvent = (e: StorageEvent) => {
      if (e.key === ADVENTUROUS_STORAGE_KEY) {
        confirmed = readAdventurousFromStorage(initial) // another tab saved it
        syncFromStorage()
      }
    }

    window.addEventListener(ADVENTUROUS_EVENT_NAME, syncFromStorage)
    window.addEventListener("storage", handleStorageEvent)

    return () => {
      window.removeEventListener(ADVENTUROUS_EVENT_NAME, syncFromStorage)
      window.removeEventListener("storage", handleStorageEvent)
    }
  }, [initial])

  // ── Writer: ordered saves, newest-wins rollback (createAdventurousWriter) ──
  // One writer per hook instance (stable across renders). After mount `confirmed` is always set
  // (adoptServerAdventurous), so the creation-time fallback only matters before the first effect.
  const [setAdventurous] = useState(() => createAdventurousWriter({ setState: setAdventurousState, fallback: () => initial }))

  return { adventurous, setAdventurous }
}
