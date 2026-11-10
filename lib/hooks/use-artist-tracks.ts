"use client"

import { useEffect, useState } from "react"
import type { Track } from "@/lib/music-provider/types"

// ─── Public interface ─────────────────────────────────────────────────────────

export interface UseArtistTracksOptions {
  artistId: string
  artistName: string
  initialTracks: Track[]
}

export interface UseArtistTracksResult {
  tracks: Track[]
  isFetching: boolean
}

// ─── Testable pure helpers ────────────────────────────────────────────────────
// Exported so tests can call them without React.

/**
 * Build the URL for fetching tracks for a given artist.
 */
export function buildArtistTracksUrl(artistId: string, artistName: string): string {
  return `/api/artists/${artistId}/tracks?name=${encodeURIComponent(artistName)}`
}

/**
 * Given a fetch response body, return the tracks array if it is non-empty,
 * or null if there is nothing worth setting (empty or missing).
 */
export function extractTracksFromResponse(data: unknown): Track[] | null {
  if (
    data !== null &&
    typeof data === "object" &&
    "tracks" in data &&
    Array.isArray((data as { tracks: unknown }).tracks) &&
    (data as { tracks: Track[] }).tracks.length > 0
  ) {
    return (data as { tracks: Track[] }).tracks
  }
  return null
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

/**
 * Manages local track state for an artist card, fetching from the API when
 * the artist has no pre-fetched tracks.
 *
 * `isFetching` is derived, not set from the effect: it is true from the very
 * first render until the request for this artist settles. (Setting it inside
 * the effect raced: when the effect ran outside a discrete event, a fast
 * response could settle before any render saw `true`, so callers could not
 * tell "not started" from "found nothing".)
 */
export function useArtistTracks({
  artistId,
  artistName,
  initialTracks,
}: UseArtistTracksOptions): UseArtistTracksResult {
  const [tracks, setTracks] = useState<Track[]>(initialTracks)
  /** The artist whose request has settled (success, empty or failure). */
  const [settledFor, setSettledFor] = useState<string | null>(null)
  const needed = initialTracks.length === 0 && tracks.length === 0

  useEffect(() => {
    if (!needed) return
    const ctrl = new AbortController()
    fetch(buildArtistTracksUrl(artistId, artistName), { signal: ctrl.signal })
      .then((r) => {
        if (!r.ok) throw new Error("fetch failed")
        return r.json()
      })
      .then((data) => {
        if (ctrl.signal.aborted) return
        const extracted = extractTracksFromResponse(data)
        if (extracted) setTracks(extracted)
      })
      .catch(() => {
        // Silent: the caller shows its "no tracks" fallback once settled.
      })
      .finally(() => {
        if (!ctrl.signal.aborted) setSettledFor(artistId)
      })
    return () => ctrl.abort()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fetch once per artist while tracks are empty
  }, [initialTracks.length, artistName, artistId])

  return { tracks, isFetching: needed && settledFor !== artistId }
}
