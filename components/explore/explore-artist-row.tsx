"use client"

import { memo, useCallback, useMemo } from "react"
import { motion } from "framer-motion"
import { ArtistCard } from "@/components/feed/artist-card"
import type { RailArtist } from "@/components/explore/rail"
import type { MusicPlatform } from "@/lib/music-links"
import type { Track } from "@/lib/music-provider/types"

const MemoArtistCard = memo(ArtistCard)

interface ArtistWithTracks {
  id: string
  name: string
  genres: string[]
  imageUrl: string | null
  popularity: number
  topTracks: Track[]
}

interface RecommendationShape {
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

function railArtistToRecommendation(a: RailArtist): RecommendationShape {
  const sourceArtists = a.why?.sourceArtist ? [a.why.sourceArtist] : []
  const genres = a.why?.tag ? [a.why.tag] : []
  return {
    spotify_artist_id: a.id,
    artist_data: {
      id: a.id,
      name: a.name,
      genres: a.genres,
      imageUrl: a.imageUrl,
      popularity: a.popularity,
      topTracks: [],
    },
    score: 0,
    why: { sourceArtists, genres, friendBoost: [] },
    artist_color: a.artistColor ?? null,
  }
}

interface ExploreArtistRowProps {
  artist: RailArtist
  musicPlatform: MusicPlatform
  isSaved: boolean
  dismissSignal: string | null
  onSave: (artistId: string) => void
  onFeedback: (artistId: string, signal: string) => void
}

export const ExploreArtistRow = memo(function ExploreArtistRow({
  artist,
  musicPlatform,
  isSaved,
  dismissSignal,
  onSave,
  onFeedback,
}: ExploreArtistRowProps) {
  const handleSave = useCallback(() => onSave(artist.id), [artist.id, onSave])
  const handleFeedback = useCallback(
    (sig: string) => onFeedback(artist.id, sig),
    [artist.id, onFeedback],
  )
  const recommendation = useMemo(() => railArtistToRecommendation(artist), [artist])

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      transition={{ type: "spring", stiffness: 400, damping: 40 }}
    >
      <MemoArtistCard
        recommendation={recommendation}
        musicPlatform={musicPlatform}
        onSave={handleSave}
        onFeedback={handleFeedback}
        isSaved={isSaved}
        dismissSignal={dismissSignal}
      />
    </motion.div>
  )
})
