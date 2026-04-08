"use client"

import { useState } from "react"
import Link from "next/link"
import { CheckCircle2, Sparkles } from "lucide-react"
import { ArtistCard } from "@/components/feed/artist-card"

interface Track {
  id: string
  spotifyTrackId: string | null
  name: string
  previewUrl: string | null
  durationMs: number
  albumName: string
  albumImageUrl: string | null
  source: 'itunes' | 'spotify' | 'deezer'
}

interface ArtistWithTracks {
  id: string
  name: string
  genres: string[]
  imageUrl: string | null
  popularity: number
  topTracks: Track[]
}

interface Recommendation {
  spotify_artist_id: string
  artist_data: ArtistWithTracks
  score: number
  why: {
    sourceArtists: string[]
    genres: string[]
    friendBoost: string[]
  }
}

interface FeedClientProps {
  recommendations: Recommendation[]
}

export function FeedClient({ recommendations }: FeedClientProps) {
  const [actedIds, setActedIds] = useState<Set<string>>(new Set())

  // Generation now only happens from the splash page ("Find me music" button),
  // so the feed is a pure display route — no auto-replenish side effects here.

  const visibleRecs = recommendations.filter(
    (r) => !actedIds.has(r.spotify_artist_id)
  )

  function handleActed(artistId: string) {
    setActedIds((prev) => new Set(prev).add(artistId))
  }

  const allCaughtUp = visibleRecs.length === 0

  const feedContent = allCaughtUp ? (
    <div className="flex flex-col items-center justify-center gap-3 py-20 text-center">
      <div className="flex size-14 items-center justify-center rounded-full bg-primary/10 ring-1 ring-primary/20">
        <CheckCircle2 className="size-7 text-primary" />
      </div>
      <p className="text-base font-semibold text-foreground">
        You&apos;re all caught up!
      </p>
      <p className="text-sm text-muted-foreground">Want another batch?</p>
      <Link
        href="/"
        className="mt-2 inline-flex items-center justify-center gap-2 h-11 px-5 rounded-lg bg-primary text-primary-foreground font-semibold text-sm transition-opacity hover:opacity-90"
      >
        <Sparkles className="size-4" />
        Find more music
      </Link>
    </div>
  ) : (
    <div className="flex flex-col items-center gap-5 pb-8">
      {visibleRecs.map((rec) => (
        <ArtistCard
          key={rec.spotify_artist_id}
          spotifyArtistId={rec.spotify_artist_id}
          artist={rec.artist_data}
          why={rec.why}
          onActed={handleActed}
        />
      ))}
    </div>
  )

  return (
    <div className="mx-auto w-full max-w-xl px-4 pt-6">
      {feedContent}
    </div>
  )
}
