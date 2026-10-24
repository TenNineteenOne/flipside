"use client"

import { memo, useCallback } from "react"
import { motion } from "framer-motion"
import { ArtistCard } from "@/components/feed/artist-card"
import type { CardArtist } from "@/lib/cards/card-artist"
import type { MusicPlatform } from "@/lib/music-links"

interface ExploreArtistRowProps {
  artist: CardArtist
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

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      transition={{ type: "spring", stiffness: 400, damping: 40 }}
    >
      <ArtistCard
        artist={artist}
        musicPlatform={musicPlatform}
        onSave={handleSave}
        onFeedback={handleFeedback}
        isSaved={isSaved}
        dismissSignal={dismissSignal}
      />
    </motion.div>
  )
})
