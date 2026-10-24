"use client"

import { useMemo, useState, useSyncExternalStore } from "react"
import { toast } from "sonner"
import { createArtistSaves, type ArtistSaves } from "@/lib/client/artist-signals"

export interface UseArtistSavesOptions {
  /** Artist IDs to pre-populate the saved set (e.g. from a server query). Read once at mount. */
  initialSavedIds?: string[]
  /** Read once at mount. */
  errorMessages?: {
    /** Default: "Couldn't save — try again" */
    saveFailed?: string
    /** Default: "Couldn't unsave — try again" */
    unsaveFailed?: string
  }
}

export interface UseArtistSavesResult {
  savedIds: ReadonlySet<string>
  /**
   * Optimistically toggle the saved state, then POST or DELETE /api/saves.
   * Serialized per artist; rolled back + toasted on failure.
   */
  toggleSave: ArtistSaves["toggleSave"]
}

/** React adapter for `createArtistSaves` (lib/client/artist-signals). `toggleSave` is stable. */
export function useArtistSaves(opts?: UseArtistSavesOptions): UseArtistSavesResult {
  const [controller] = useState(() =>
    createArtistSaves({ toast, initialSavedIds: opts?.initialSavedIds, messages: opts?.errorMessages }),
  )
  const snapshot = useSyncExternalStore(controller.store.subscribe, controller.store.snapshot, controller.store.snapshot)
  const savedIds = useMemo(() => new Set(snapshot.keys()), [snapshot])
  return { savedIds, toggleSave: controller.toggleSave }
}
