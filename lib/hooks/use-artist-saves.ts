"use client"

import { useCallback, useRef, useState } from "react"
import { toast } from "sonner"
import { createKeyedSerializer } from "@/lib/keyed-serializer"

// ─── Public interface ─────────────────────────────────────────────────────────

export interface UseArtistSavesOptions {
  /** Artist IDs to pre-populate the saved set (e.g. from a server query). */
  initialSavedIds?: string[]
  errorMessages?: {
    /** Default: "Couldn't save — try again" */
    saveFailed?: string
    /** Default: "Couldn't unsave — try again" */
    unsaveFailed?: string
  }
}

export interface UseArtistSavesResult {
  savedIds: Set<string>
  /**
   * Optimistically toggle the saved state for an artist, then POST or DELETE
   * /api/saves with `{ spotifyArtistId }`.
   *
   * Calls for the same artistId are serialized so rapid save/unsave clicks
   * hit the server in click order and don't leave the saved set out of sync
   * with the user's last intent.
   *
   * On failure the optimistic update is rolled back and a toast is shown.
   */
  toggleSave: (artistId: string) => Promise<void>
}

// ─── Testable pure helpers ────────────────────────────────────────────────────
// Exported so tests can call them without React. The hook composes these.

export const DEFAULT_SAVES_MESSAGES = {
  saveFailed: "Couldn't save — try again",
  unsaveFailed: "Couldn't unsave — try again",
} as const

/**
 * Build the fetch options for a save or unsave request.
 * method is "POST" when saving, "DELETE" when unsaving.
 */
export function buildSaveFetchInit(artistId: string, willUnsave: boolean): RequestInit {
  return {
    method: willUnsave ? "DELETE" : "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ spotifyArtistId: artistId }),
  }
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useArtistSaves(opts?: UseArtistSavesOptions): UseArtistSavesResult {
  const [savedIds, setSavedIds] = useState<Set<string>>(
    () => new Set(opts?.initialSavedIds ?? []),
  )

  // Mirror ref so toggleSave can read current savedIds without the callback
  // identity changing on every save (preserves memo on consumer rows).
  const savedIdsRef = useRef(savedIds)
  savedIdsRef.current = savedIds

  // Per-artist serializer: rapid save/unsave clicks serialize on the server.
  // Without this, POST/DELETE can interleave and the final server state can
  // disagree with the user's last intent.
  const queueRef = useRef(createKeyedSerializer())

  const saveFailed = opts?.errorMessages?.saveFailed ?? DEFAULT_SAVES_MESSAGES.saveFailed
  const unsaveFailed = opts?.errorMessages?.unsaveFailed ?? DEFAULT_SAVES_MESSAGES.unsaveFailed

  const toggleSave = useCallback(
    (artistId: string): Promise<void> => {
      // Capture intent before the optimistic update so the queued closure
      // uses the correct method even if another click fires first.
      const willUnsave = savedIdsRef.current.has(artistId)

      // Optimistic flip — happens before the serializer so the UI responds
      // immediately even if a prior request for this artist is still in flight.
      setSavedIds((prev) => {
        const n = new Set(prev)
        if (willUnsave) n.delete(artistId)
        else n.add(artistId)
        return n
      })

      return queueRef.current(artistId, async () => {
        try {
          const res = await fetch("/api/saves", buildSaveFetchInit(artistId, willUnsave))
          if (!res.ok) throw new Error("Server error")
        } catch {
          // Rollback
          setSavedIds((prev) => {
            const n = new Set(prev)
            if (willUnsave) n.add(artistId)
            else n.delete(artistId)
            return n
          })
          toast.error(willUnsave ? unsaveFailed : saveFailed)
        }
      })
    },
    [saveFailed, unsaveFailed],
  )

  return { savedIds, toggleSave }
}
