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
 * Mirrors the inline effect that previously lived in ArtistCard (lines 144–173).
 * The eslint-disable comment below is intentional: the effect only depends on
 * the three values that gate the fetch — not on isFetching — to avoid
 * re-running the effect after the state update that sets isFetching=true.
 */
export function useArtistTracks({
  artistId,
  artistName,
  initialTracks,
}: UseArtistTracksOptions): UseArtistTracksResult {
  const [tracks, setTracks] = useState<Track[]>(initialTracks)
  const [isFetching, setIsFetching] = useState(false)

  useEffect(() => {
    if (initialTracks.length === 0 && tracks.length === 0 && !isFetching) {
      const ctrl = new AbortController()
      setIsFetching(true)
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
        .catch((err: unknown) => {
          if (err instanceof DOMException && err.name === "AbortError") return
          // Silent — caller shows "No tracks available" fallback.
        })
        .finally(() => {
          if (!ctrl.signal.aborted) setIsFetching(false)
        })
      return () => ctrl.abort()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only fetch once when tracks are empty
  }, [initialTracks.length, artistName, artistId])

  return { tracks, isFetching }
}
