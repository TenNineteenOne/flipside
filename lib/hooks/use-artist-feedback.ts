"use client"

import { useState, useSyncExternalStore } from "react"
import { toast } from "sonner"
import { createArtistFeedback, type ArtistFeedback } from "@/lib/client/artist-signals"

export interface UseArtistFeedbackOptions {
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
  /** Put an artist back to an earlier verdict (the feed's Undo). Optimistic. */
  restore: ArtistFeedback["restore"]
}

/** React adapter for `createArtistFeedback` (lib/client/artist-signals). Callbacks are stable. */
export function useArtistFeedback(opts?: UseArtistFeedbackOptions): UseArtistFeedbackResult {
  const [api] = useState(() => createArtistFeedback({ toast, messages: opts?.errorMessages }))

  const signals = useSyncExternalStore(api.store.subscribe, api.store.snapshot, api.store.snapshot)
  return { signals, setSignal: api.setSignal, removeSignal: api.removeSignal, dismiss: api.dismiss, restore: api.restore }
}
