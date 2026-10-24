"use client"

import { useLayoutEffect, useState, useSyncExternalStore } from "react"
import { toast } from "sonner"
import { createArtistFeedback, type ArtistFeedback } from "@/lib/client/artist-signals"

export interface UseArtistFeedbackOptions {
  /**
   * When provided, the railKey is included in the POST /api/feedback body so
   * the server can narrow-invalidate only the owning rail. Read when the POST
   * is dispatched, so a rail switch between tap and send uses the new rail.
   */
  railKey?: string
  /**
   * Signal types that should update local state only — no network call.
   * Default: `[]` (all signals are POSTed, matching feed's original behavior).
   * Explore passes `["skip"]` because skip is a session-local dismiss there.
   * Read once at mount.
   */
  localOnlySignals?: readonly string[]
  /** Read once at mount. */
  errorMessages?: {
    /** Default: "Couldn't undo — try again" */
    undoFailed?: string
    /** Default: "Couldn't save feedback — try again" */
    saveFailed?: string
  }
}

export interface UseArtistFeedbackResult {
  /** Visible signal per artist (optimistic). */
  signals: ReadonlyMap<string, string>
  setSignal: ArtistFeedback["setSignal"]
  removeSignal: ArtistFeedback["removeSignal"]
  dismiss: ArtistFeedback["dismiss"]
  /**
   * Bulk local replacement — used by Explore after a shuffle or adventurous
   * apply so stale thumbs_up outlines don't carry over. No network.
   */
  setSignals: (updater: ReadonlyMap<string, string> | ((prev: ReadonlyMap<string, string>) => ReadonlyMap<string, string>)) => void
}

/** React adapter for `createArtistFeedback` (lib/client/artist-signals). Callbacks are stable. */
export function useArtistFeedback(opts?: UseArtistFeedbackOptions): UseArtistFeedbackResult {
  const [api] = useState(() => {
    const c = createArtistFeedback({
      toast,
      railKey: opts?.railKey,
      localOnlySignals: opts?.localOnlySignals,
      messages: opts?.errorMessages,
    })
    return {
      store: c.store,
      setSignal: c.setSignal,
      removeSignal: c.removeSignal,
      dismiss: c.dismiss,
      setRailKey: c.setRailKey,
      setSignals: (u: Parameters<UseArtistFeedbackResult["setSignals"]>[0]) =>
        c.store.replace(typeof u === "function" ? u : () => u),
    }
  })

  // Layout effect: applied in the same commit as the rail switch, before any
  // tap can fire (a passive effect let a same-frame thumbs-up POST the old rail).
  const railKey = opts?.railKey
  useLayoutEffect(() => {
    api.setRailKey(railKey)
  }, [api, railKey])

  const signals = useSyncExternalStore(api.store.subscribe, api.store.snapshot, api.store.snapshot)
  return { signals, setSignal: api.setSignal, removeSignal: api.removeSignal, dismiss: api.dismiss, setSignals: api.setSignals }
}
