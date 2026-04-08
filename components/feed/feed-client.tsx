"use client"

import { useState } from "react"
import Link from "next/link"
import { AnimatePresence } from "framer-motion"
import { CheckCircle2, Sparkles } from "lucide-react"
import { ArtistCard } from "@/components/feed/artist-card"
import { ArtistDrawer } from "@/components/feed/artist-drawer"

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
  artist_color?: string | null
}

interface FeedClientProps {
  recommendations: Recommendation[]
}

export function FeedClient({ recommendations }: FeedClientProps) {
  // Which artist's drawer is open (null = closed)
  const [openRecommendation, setOpenRecommendation] = useState<Recommendation | null>(null)

  // In-memory dismissed cards — resets on mount (page refresh restores all)
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(new Set())

  // Permanently saved artists — removed from the feed
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set())

  async function handleSave(artistId: string) {
    setSavedIds((prev) => new Set(prev).add(artistId))
    try {
      await fetch("/api/saves", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ spotifyArtistId: artistId }),
      })
    } catch (err) {
      console.error("[feed-client] save failed", err)
    }
  }

  // Saved cards are permanently removed; dismissed cards stay in DOM for
  // collapse animation and Undo to work
  const visibleRecs = recommendations.filter(
    (r) => !savedIds.has(r.spotify_artist_id)
  )

  const allCaughtUp = visibleRecs.length === 0

  return (
    <div
      style={{
        maxWidth: 640,
        margin: "0 auto",
        padding: "16px 16px 100px 16px",
        display: "flex",
        flexDirection: "column",
        gap: 16,
      }}
    >
      {allCaughtUp ? (
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
        visibleRecs.map((rec) => (
          <ArtistCard
            key={rec.spotify_artist_id}
            recommendation={rec}
            onOpen={() => setOpenRecommendation(rec)}
            onSave={() => handleSave(rec.spotify_artist_id)}
            onDismiss={() =>
              setDismissedIds((prev) => new Set(prev).add(rec.spotify_artist_id))
            }
          />
        ))
      )}

      <AnimatePresence>
        <ArtistDrawer
          recommendation={openRecommendation}
          artistColor={openRecommendation?.artist_color ?? '#8b5cf6'}
          isOpen={openRecommendation !== null}
          onDismiss={() => setOpenRecommendation(null)}
          onDismissAndCollapse={() => {
            if (openRecommendation) {
              setDismissedIds((prev) =>
                new Set(prev).add(openRecommendation.spotify_artist_id)
              )
            }
            setOpenRecommendation(null)
          }}
          onSave={() =>
            openRecommendation && handleSave(openRecommendation.spotify_artist_id)
          }
        />
      </AnimatePresence>
    </div>
  )
}
