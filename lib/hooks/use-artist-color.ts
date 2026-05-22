"use client"

import { useMemo } from "react"
import { sanitizeHex, stringToVibrantHex } from "@/lib/color-utils"

// ─── Testable pure helper ─────────────────────────────────────────────────────
// Exported so tests and non-React callers (e.g. saved-client.tsx) can use
// this without a hook wrapper.

/**
 * Resolve the display color for an artist.
 *
 * sanitizeHex returns "#8b5cf6" as its fallback when the stored color is null,
 * undefined, empty, or an invalid hex. We treat that sentinel as "no real color"
 * and fall back to the deterministic name-hash so every artist gets a
 * distinctive tint.
 */
export function resolveArtistColor(rawColor: string | null | undefined, artistName: string): string {
  const sanitized = sanitizeHex(rawColor)
  if (sanitized === "#8b5cf6") return stringToVibrantHex(artistName)
  return sanitized
}

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
