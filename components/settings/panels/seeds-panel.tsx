"use client"

import { LibraryEditor } from "@/components/settings/library-editor"
import type { SpotifyArtist } from "@/components/onboarding/artist-search"

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
