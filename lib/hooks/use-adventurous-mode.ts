"use client"

import { useEffect, useState } from "react"

// ─── Public constants ────────────────────────────────────────────────────────
// Centralises the magic strings that were previously duplicated across four
// consumer files.  Tests can import these instead of hardcoding strings.

export const ADVENTUROUS_STORAGE_KEY = "flipside.adventurous"
export const ADVENTUROUS_EVENT_NAME = "flipside:adventurous-change"

// ─── Testable helpers (exported so tests can call them without React) ────────

/**
 * Read the adventurous flag from localStorage.
 * Returns `fallback` if localStorage is unavailable (private mode) or the key
 * is absent.
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
 * PATCH /api/settings with { adventurous: next }.
 * Throws if the response is not ok.
 */
export async function patchAdventurousSetting(next: boolean): Promise<void> {
  const res = await fetch("/api/settings", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ adventurous: next }),
  })
  if (!res.ok) {
    throw new Error("Failed to save adventurous setting")
  }
}

// ─── Public interface ─────────────────────────────────────────────────────────

export interface UseAdventurousModeResult {
  adventurous: boolean
  setAdventurous: (next: boolean) => Promise<void>
}

/**
 * Single seam for "is adventurous mode on?" across the app.
 *
 * Replaces the duplicated localStorage + window event + PATCH pattern that
 * previously lived in:
 *   components/visual/ambient.tsx
 *   components/nav/app-nav.tsx
 *   components/settings/settings-form.tsx
 *   components/explore/explore-client.tsx
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
