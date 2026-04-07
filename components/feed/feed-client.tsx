"use client"

import { useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { CheckCircle2 } from "lucide-react"
import { ArtistCard } from "@/components/feed/artist-card"

interface Track {
  id: string
  name: string
  previewUrl: string | null
  durationMs: number
  albumName: string
  albumImageUrl: string | null
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
  const router = useRouter()
  const [actedIds, setActedIds] = useState<Set<string>>(new Set())
  const generatingRef = useRef(false)
  const lastGenTimeRef = useRef(0)

  // Auto-replenish when fewer than 5 unseen recommendations remain.
  // 60s cooldown prevents a loop when partial generation (< 5 recs) keeps
  // triggering re-generation and deleting the partial results.
  useEffect(() => {
    const remaining = recommendations.filter(
      (r) => !actedIds.has(r.spotify_artist_id)
    ).length
    const cooldownMs = 60_000
    const elapsed = Date.now() - lastGenTimeRef.current
    if (remaining < 5 && !generatingRef.current && elapsed > cooldownMs) {
      generatingRef.current = true
      lastGenTimeRef.current = Date.now()
      fetch("/api/recommendations/generate", { method: "POST" })
        .then(() => router.refresh())
        .catch((err) => { console.error(`[feed] replenish failed:`, err) })
        .finally(() => { generatingRef.current = false })
    }
  }, [actedIds, recommendations, router])

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
      <p className="text-sm text-muted-foreground">Check back tomorrow for new discoveries.</p>
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
