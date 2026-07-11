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

export interface FeedbackCallOptions {
  /**
   * Called once the operation settles, after any optimistic rollback + toast
   * has already happened. `success` is false when the network call failed.
   * Optional — feed/explore ignore it and just fire-and-forget; callers that
   * keep their own parallel state (e.g. a list rendered independently of
   * `signals`) can use it to mirror the rollback.
   */
  onSettled?: (success: boolean) => void
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
  setSignal: (artistId: string, signal: string, callOpts?: FeedbackCallOptions) => Promise<void>
  /**
   * Unconditionally clear an artist's feedback signal — DELETE /api/feedback/{id}
   * regardless of what the current signal is (unlike `setSignal`, which only
   * deletes on the thumbs_up-toggle-off case). For "undo" UIs where any signal
   * (liked, passed, skipped) can be undone, not just a like.
   *
   * Shares the same per-artist queue as `setSignal`, so an undo and a signal
   * change for the same artist always land on the server in click order.
   */
  removeSignal: (artistId: string, callOpts?: FeedbackCallOptions) => Promise<void>
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
  const body: Record<string, string> = { artistId, signal }
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

  // Stable ref for railKey so the queued POST thunk reads the CURRENT rail
  // when it eventually dispatches, not the rail that was active when the tap
  // landed. Without this, a user who taps thumbs_up on rail A then switches
  // to rail B before the network call leaves would send railKey=A in the
  // body — telling the server to narrow-invalidate the wrong rail's cache.
  const railKeyRef = useRef(railKey)
  railKeyRef.current = railKey

  const setSignal = useCallback(
    (artistId: string, signal: string, callOpts?: FeedbackCallOptions): Promise<void> => {
      return queueRef.current(artistId, async () => {
        const currentSignal = signalsRef.current.get(artistId)
        const op = classifyFeedbackOp(signal, currentSignal, localOnlySignalsRef.current)

        if (op === "local") {
          setSignalsState((prev) => new Map(prev).set(artistId, signal))
          callOpts?.onSettled?.(true)
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
            callOpts?.onSettled?.(true)
          } catch {
            // Rollback
            setSignalsState((prev) => new Map(prev).set(artistId, "thumbs_up"))
            toast.error(undoFailed)
            callOpts?.onSettled?.(false)
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
            // Read railKey from the ref at dispatch time so a rail switch
            // between tap and network send doesn't send a stale rail.
            body: JSON.stringify(buildFeedbackPostBody(artistId, signal, railKeyRef.current)),
          })
          if (!res.ok) throw new Error("Server error")
          callOpts?.onSettled?.(true)
        } catch {
          // Rollback to prior state
          setSignalsState((prev) => {
            const next = new Map(prev)
            if (currentSignal === undefined) next.delete(artistId)
            else next.set(artistId, currentSignal)
            return next
          })
          toast.error(saveFailed)
          callOpts?.onSettled?.(false)
        }
      })
    },
    // railKey intentionally NOT in deps — the thunk reads railKeyRef.current
    // at dispatch time, so setSignal identity stays stable across rail
    // switches (preserves memo on consumer rows).
    [undoFailed, saveFailed],
  )

  // Unconditional undo — DELETE regardless of current signal. Shares queueRef
  // with setSignal so an undo serializes with a concurrent signal change on
  // the same artistId.
  const removeSignal = useCallback(
    (artistId: string, callOpts?: FeedbackCallOptions): Promise<void> => {
      return queueRef.current(artistId, async () => {
        const prevSignal = signalsRef.current.get(artistId)
        setSignalsState((prev) => {
          const next = new Map(prev)
          next.delete(artistId)
          return next
        })
        try {
          const res = await fetch(buildFeedbackDeleteUrl(artistId), { method: "DELETE" })
          if (!res.ok && res.status !== 204) throw new Error("Server error")
          callOpts?.onSettled?.(true)
        } catch {
          // Rollback
          if (prevSignal !== undefined) {
            setSignalsState((prev) => new Map(prev).set(artistId, prevSignal))
          }
          toast.error(undoFailed)
          callOpts?.onSettled?.(false)
        }
      })
    },
    [undoFailed],
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

  return { signals, setSignal, removeSignal, setSignals }
}
