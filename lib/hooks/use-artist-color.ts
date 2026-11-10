"use client"

import { useMemo } from "react"
import { resolveArtistColor } from "@/lib/color-utils"

// ─── Hook ─────────────────────────────────────────────────────────────────────

/**
 * Memoized artist color resolution.
 *
 * Returns the sanitized hex when valid (non-default), or a deterministic
 * vibrant color derived from the artist name when the stored color is absent
 * or the default sentinel (#8b5cf6).
 */
export function useArtistColor(rawColor: string | null | undefined, artistName: string): string {
  return useMemo(
    () => resolveArtistColor(rawColor, artistName),
    [rawColor, artistName],
  )
}
