"use client"

import { memo, useState } from "react"
import Image from "next/image"
import { Play } from "lucide-react"
import { artworkAt } from "@/lib/feed/artwork"
import { formatDuration } from "@/lib/feed/card-copy"
import type { Track } from "@/lib/music-provider/types"

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface TrackStripProps {
  tracks: Track[]
  /** Kept for callers; the strip takes the artist colour from the card's --a. */
  artistColor?: string
  compact?: boolean          // Optional for dense UI views: first track only
  onPlay?: (track: Track) => void
}

// ---------------------------------------------------------------------------
// Component: the Explore card's track list (styles in artist-card.css, .ex-tracks).
// Each row is one button that plays its track; the artwork shows a play glyph.
// ---------------------------------------------------------------------------

export const TrackStrip = memo(function TrackStrip({
  tracks,
  compact = false,
  onPlay,
}: TrackStripProps) {
  const [isExpanded, setIsExpanded] = useState(false)

  if (tracks.length === 0) return null

  const handlePlayClick = (e: React.MouseEvent, track: Track) => {
    e.stopPropagation()
    onPlay?.(track)
  }

  const displayTracks = compact ? tracks.slice(0, 1) : (isExpanded ? tracks : tracks.slice(0, 3))
  const remainingCount = tracks.length - displayTracks.length

  return (
    <ul className="ex-tracks">
      {displayTracks.map((track) => (
        <li key={track.id}>
          <button type="button" className="ex-track" onClick={(e) => handlePlayClick(e, track)} aria-label={`Play ${track.name}`}>
            <span className="ex-track-art">
              {track.albumImageUrl && (
                <Image src={artworkAt(track.albumImageUrl, 40)} alt="" width={40} height={40} unoptimized />
              )}
              <span className="ex-track-play" aria-hidden>
                <Play size={14} fill="currentColor" strokeWidth={0} />
              </span>
            </span>
            <span className="ex-track-text">
              <span className="ex-track-name">{track.name}</span>
              {track.albumName && <span className="ex-track-album">{track.albumName}</span>}
            </span>
            <span className="ex-track-dur">{formatDuration(track.durationMs)}</span>
          </button>
        </li>
      ))}

      {remainingCount > 0 && !compact && (
        <li>
          <button
            type="button"
            className="ex-track ex-track-more"
            onClick={(e) => {
              e.stopPropagation()
              setIsExpanded(true)
            }}
          >
            <span className="ex-track-art ex-track-count">+{remainingCount}</span>
            <span className="ex-track-name">View all tracks</span>
          </button>
        </li>
      )}
    </ul>
  )
})
