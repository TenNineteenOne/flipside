"use client"

import { useCallback, useRef, useState } from "react"
import { toast } from "sonner"
import { createKeyedSerializer } from "@/lib/keyed-serializer"

// ─── Public interface ─────────────────────────────────────────────────────────

export interface UseArtistFeedbackOptions {
  /**
   * When provided, the railKey is included in the POST /api/feedback body so
   * the server can narrow-invalidate only the owning rail. Other rails pick up
   * the signal on their own TTL via the persisted feedback row.
   */
  railKey?: string
  /**
   * Signal types that should update local state only — no network call.
   * Default: `[]` (all signals are POSTed, matching feed's original behavior).
   * Explore passes `["skip"]` because skip is a session-local dismiss there.
   */
  localOnlySignals?: readonly string[]
  errorMessages?: {
    /** Default: "Couldn't undo — try again" */
    undoFailed?: string
    /** Default: "Couldn't save feedback — try again" */
    saveFailed?: string
  }
}

export interface UseArtistFeedbackResult {
  signals: Map<string, string>
  /**
   * Set a feedback signal for an artist.
   *
   * - Signal in `localOnlySignals` (from opts) → local-only update; no network call.
   * - `"thumbs_up"` when already `"thumbs_up"` → DELETE /api/feedback/{id} (undo).
   *   Migration 0033 leaves seen_at set, so the card still won't return on next
   *   refresh — undo is session-only.
   * - Any other combination → POST /api/feedback.
   *
   * All calls for the same artistId are serialized so rapid taps (like → unlike
   * → like) always hit the server in intent order.
   */
  setSignal: (artistId: string, signal: string) => Promise<void>
  /**
   * Replace the entire signals Map. Pass `new Map()` to clear all signals —
   * used by explore-client after a shuffle or adventurous apply so stale
   * thumbs_up outlines don't carry over to the refreshed deck.
   *
   * Prefer targeted setSignal calls for individual mutations; use setSignals
   * only when you need bulk replacement.
   */
  setSignals: (updater: Map<string, string> | ((prev: Map<string, string>) => Map<string, string>)) => void
}

// ─── Testable pure helpers ────────────────────────────────────────────────────
// Exported so tests can call them without React. The hook composes these.

export const DEFAULT_FEEDBACK_MESSAGES = {
  undoFailed: "Couldn't undo — try again",
  saveFailed: "Couldn't save feedback — try again",
} as const

/**
 * Build the DELETE URL for an undo operation.
 */
export function buildFeedbackDeleteUrl(artistId: string): string {
  return `/api/feedback/${encodeURIComponent(artistId)}`
}

/**
 * Build the POST body for a feedback signal.
 * railKey is omitted from the object when undefined so JSON.stringify never
 * includes it (avoids sending `"railKey": undefined` → `null` drift).
 */
export function buildFeedbackPostBody(
  artistId: string,
  signal: string,
  railKey: string | undefined,
): Record<string, string> {
  const body: Record<string, string> = { spotifyArtistId: artistId, signal }
  if (railKey !== undefined) body.railKey = railKey
  return body
}

/**
 * Determine the operation type for a setSignal call.
 * Returns:
 *   "local"  — local-only, no network call (signal is in localOnlySignals)
 *   "delete" — undo (thumbs_up toggled off)
 *   "post"   — normal signal (thumbs_up first time, thumbs_down, etc.)
 */
export function classifyFeedbackOp(
  signal: string,
  currentSignal: string | undefined,
  localOnlySignals: readonly string[] = [],
): "local" | "delete" | "post" {
  if (localOnlySignals.includes(signal)) return "local"
  if (signal === "thumbs_up" && currentSignal === "thumbs_up") return "delete"
  return "post"
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useArtistFeedback(opts?: UseArtistFeedbackOptions): UseArtistFeedbackResult {
  const [signals, setSignalsState] = useState<Map<string, string>>(new Map())

  // Mirror ref so setSignal callback can read current signals without the
  // callback identity changing on every render (preserves memo on consumer rows).
  const signalsRef = useRef(signals)
  signalsRef.current = signals

  // Per-artist serializer: rapid like/unlike taps serialize on the server.
  // Without this, DELETE and POST can race and the final server state can
  // disagree with the user's last intent.
  const queueRef = useRef(createKeyedSerializer())

  const railKey = opts?.railKey
  const localOnlySignals = opts?.localOnlySignals ?? []
  const undoFailed = opts?.errorMessages?.undoFailed ?? DEFAULT_FEEDBACK_MESSAGES.undoFailed
  const saveFailed = opts?.errorMessages?.saveFailed ?? DEFAULT_FEEDBACK_MESSAGES.saveFailed

  // Stable ref for localOnlySignals so callback identity doesn't change when
  // callers pass a fresh array literal each render.
  const localOnlySignalsRef = useRef(localOnlySignals)
  localOnlySignalsRef.current = localOnlySignals

  const setSignal = useCallback(
    (artistId: string, signal: string): Promise<void> => {
      return queueRef.current(artistId, async () => {
        const currentSignal = signalsRef.current.get(artistId)
        const op = classifyFeedbackOp(signal, currentSignal, localOnlySignalsRef.current)

        if (op === "local") {
          setSignalsState((prev) => new Map(prev).set(artistId, signal))
          return
        }

        if (op === "delete") {
          // Optimistic: remove the thumbs_up
          setSignalsState((prev) => {
            const next = new Map(prev)
            next.delete(artistId)
            return next
          })
          try {
            const res = await fetch(buildFeedbackDeleteUrl(artistId), { method: "DELETE" })
            if (!res.ok && res.status !== 204) throw new Error("Server error")
          } catch {
            // Rollback
            setSignalsState((prev) => new Map(prev).set(artistId, "thumbs_up"))
            toast.error(undoFailed)
          }
          return
        }

        // op === "post"
        // Optimistic: set the new signal
        setSignalsState((prev) => new Map(prev).set(artistId, signal))
        try {
          const res = await fetch("/api/feedback", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(buildFeedbackPostBody(artistId, signal, railKey)),
          })
          if (!res.ok) throw new Error("Server error")
        } catch {
          // Rollback to prior state
          setSignalsState((prev) => {
            const next = new Map(prev)
            if (currentSignal === undefined) next.delete(artistId)
            else next.set(artistId, currentSignal)
            return next
          })
          toast.error(saveFailed)
        }
      })
    },
    // railKey is stable per render of the parent (it's the activeKey value at
    // the time the hook was last called). The callback identity re-stabilizes
    // when railKey changes — intentional, since a new rail is active.
    [railKey, undoFailed, saveFailed],
  )

  const setSignals = useCallback(
    (updater: Map<string, string> | ((prev: Map<string, string>) => Map<string, string>)) => {
      if (typeof updater === "function") {
        setSignalsState(updater)
      } else {
        setSignalsState(updater)
      }
    },
    [],
  )

  return { signals, setSignal, setSignals }
}
