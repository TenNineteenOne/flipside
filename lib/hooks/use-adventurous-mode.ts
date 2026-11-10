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
 * SSR-safe: the initial render uses `initial` (from the server).  On mount the
 * hook reconciles with localStorage in case another tab wrote a newer value
 * before this component mounted.
 *
 * The hook does NOT toast on failure and does NOT call any rebuild helpers —
 * those are caller responsibilities so each surface can react differently.
 */
export function useAdventurousMode(initial: boolean): UseAdventurousModeResult {
  const [adventurous, setAdventurousState] = useState(initial)

  // ── Mount effect: reconcile with localStorage + subscribe to sync events ──
  useEffect(() => {
    // Re-read localStorage and update state from it.  Used for both the initial
    // reconciliation and for in-tab / cross-tab event-driven updates.
    const syncFromStorage = () => {
      setAdventurousState(readAdventurousFromStorage(initial))
    }

    // Reconcile: another tab or a previous session may have written a newer
    // value before this component mounted.  We call syncFromStorage as a
    // callback (not inline) to satisfy the react-hooks/set-state-in-effect rule.
    syncFromStorage()

    const handleStorageEvent = (e: StorageEvent) => {
      if (e.key === ADVENTUROUS_STORAGE_KEY) {
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

  // ── Writer ───────────────────────────────────────────────────────────────
  const setAdventurous = async (next: boolean): Promise<void> => {
    // 1. Optimistic update
    setAdventurousState(next)

    try {
      // 2. Persist to the server
      await patchAdventurousSetting(next)

      // 3. On success: write localStorage + broadcast in-tab event
      writeAdventurousToStorage(next)
      dispatchAdventurousEvent()
    } catch (err) {
      // 4. On failure: roll back and re-throw so callers can handle (e.g. toast)
      setAdventurousState(!next)
      throw err
    }
  }

  return { adventurous, setAdventurous }
}
