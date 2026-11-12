"use client"

import dynamic from "next/dynamic"
import type { SpotifyArtist } from "@/components/onboarding/artist-search"

// Client-only and split out: LibraryEditor pulls in the genre picker tree
// (data/genres-picker.json, ~66 kB gzip), which shouldn't block Settings'
// first load. It maps saved tags to nodes on mount, so it must not mount
// before that data exists; loading the whole editor lazily keeps that true.
const LibraryEditor = dynamic(
  () => import("@/components/settings/library-editor").then((m) => m.LibraryEditor),
  {
    ssr: false,
    loading: () => (
      <div className="col gap-10" aria-busy="true">
        <div className="fs-skeleton" style={{ height: 36, borderRadius: 8 }} />
        <div className="fs-skeleton" style={{ height: 36, borderRadius: 8 }} />
      </div>
    ),
  },
)

interface SeedsPanelProps {
  initialSelectedGenres: string[]
  initialSeedArtists: SpotifyArtist[]
}

export function SeedsPanel({ initialSelectedGenres, initialSeedArtists }: SeedsPanelProps) {
  return (
    <div>
      <div className="eyebrow" style={{ marginBottom: 10 }}>Seeds</div>
      <div className="fs-card">
        <LibraryEditor
          initialGenreTags={initialSelectedGenres}
          initialSeedArtists={initialSeedArtists}
          flat
        />
      </div>
    </div>
  )
}
