// Design-lab mock data. Real iTunes artwork + 30s previews (see scripts/lab-fetch-artists.mjs).
import type { Track } from "@/lib/music-provider/types"
import raw from "./artists.json"

export interface LabArtist {
  id: string
  name: string
  genres: string[]
  /** 600x600 album art (https://*.mzstatic.com — already allowed by the CSP). */
  imageUrl: string
  popularity: number
  /** Palette extracted from the artwork. */
  color: string
  colorDark: string
  colorLight: string
  why: { sourceArtists: string[]; genres: string[] }
  topTracks: Track[]
}

export const labArtists: LabArtist[] = raw.map(({ tracks, ...a }) => ({
  ...a,
  topTracks: tracks.map((t) => ({ ...t, spotifyTrackId: null, source: "itunes" as const })),
}))
