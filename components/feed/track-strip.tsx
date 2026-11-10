"use client"

import { memo, useState } from "react"
import Image from "next/image"
import { Play } from "lucide-react"
import { hexToRgba } from "@/lib/color-utils"
import { artworkAt } from "@/lib/feed/artwork"
import type { Track } from "@/lib/music-provider/types"

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface TrackStripProps {
  tracks: Track[]
  artistColor?: string       // hex, defaults to '#8b5cf6'
  compact?: boolean          // Optional for dense UI views like Saved screen
  onPlay?: (track: Track) => void
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const TrackStrip = memo(function TrackStrip({
  tracks,
  artistColor = "#8b5cf6",
  compact = false,
  onPlay,
}: TrackStripProps) {
  const [isExpanded, setIsExpanded] = useState(false)

  if (tracks.length === 0) return null

  // Artist-colour tint fading into the card's --panel surface
  const baseTintFlow = `linear-gradient(90deg, ${hexToRgba(artistColor, 0.22)} 0%, var(--panel) 100%)`

  const handlePlayClick = (e: React.MouseEvent, track: Track) => {
    e.stopPropagation()
    onPlay?.(track)
  }

  // Define how many tracks show. In feed, maybe show 3 maximum normally
  const displayTracks = compact ? tracks.slice(0, 1) : (isExpanded ? tracks : tracks.slice(0, 3))
  const remainingCount = tracks.length - displayTracks.length

  return (
    <div className="flex flex-col gap-[3px] mt-2 mb-2 px-1 w-full">
      {displayTracks.map((track, index) => {
        const isFeatured = index === 0 && !compact

        // For the first track, it gets the largest treatment
        if (isFeatured) {
          return (
            <div
              key={track.id}
              onClick={(e) => handlePlayClick(e, track)}
              className="rounded-xl p-3 flex items-center gap-4 cursor-pointer transition-transform hover:translate-x-1"
              style={{
                background: baseTintFlow,
                border: "1px solid var(--line-strong)"
              }}
            >
              <div className="relative w-12 h-12 shrink-0">
                {track.albumImageUrl ? (
                  <Image
                    src={artworkAt(track.albumImageUrl, 48)}
                    alt={track.albumName}
                    width={48}
                    height={48}
                    className="rounded-lg object-cover shadow-lg w-full h-full"
                    unoptimized
                  />
                ) : (
                  <div className="w-full h-full rounded-lg" style={{ background: "var(--raise)" }} />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[15px] font-semibold text-[var(--fg)] truncate">
                  {track.name}
                </div>
                {/* Secondary artist mapping (safeguard missing values) */}
                <div className="text-[13px] text-[var(--fg-3)] mt-0.5 truncate">
                  {track.albumName}
                </div>
              </div>
              <div className="flex shrink-0 items-center justify-center gap-1">
                <button
                  onClick={(e) => handlePlayClick(e, track)}
                  className="w-10 h-10 rounded-full text-black flex items-center justify-center shrink-0 border-none transition-transform hover:scale-105"
                  style={{ backgroundColor: artistColor }}
                  aria-label={`Play ${track.name}`}
                >
                  <Play size={16} fill="currentColor" strokeWidth={0} />
                </button>
              </div>
            </div>
          )
        }

        // Secondary tracks
        return (
          <div
            key={track.id}
            onClick={(e) => handlePlayClick(e, track)}
            className="rounded-xl p-2.5 flex items-center gap-4 cursor-pointer transition-transform hover:translate-x-1"
            style={{
              background: baseTintFlow,
              border: "1px solid var(--line)"
            }}
          >
            <div className="relative w-10 h-10 shrink-0">
               {track.albumImageUrl ? (
                 <Image
                   src={artworkAt(track.albumImageUrl, 40)}
                   alt={track.albumName}
                   width={40}
                   height={40}
                   className="rounded-lg object-cover opacity-80 w-full h-full"
                   unoptimized
                 />
               ) : (
                 <div className="w-full h-full rounded-lg opacity-80" style={{ background: "var(--raise)" }} />
               )}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-[14px] font-medium text-[var(--fg-2)] truncate pr-2">
                {track.name}
              </div>
            </div>
            <div className="flex shrink-0 items-center justify-center gap-1">
              <button
                  onClick={(e) => handlePlayClick(e, track)}
                  className="w-8 h-8 rounded-full text-white flex items-center justify-center shrink-0 border border-white/20 transition-colors hover:bg-white hover:text-black"
                  aria-label={`Play ${track.name}`}
                >
                  <Play size={12} fill="currentColor" strokeWidth={0} />
              </button>
            </div>
          </div>
        )
      })}

      {/* Overflow tracking "+ X tracks" expanding button */}
      {remainingCount > 0 && !compact && (
        <button
          type="button"
          className="rounded-xl p-2.5 flex items-center gap-4 cursor-pointer text-left transition-transform hover:translate-x-1"
          style={{
            background: baseTintFlow,
            border: "1px solid var(--line)"
          }}
          onClick={(e) => {
            e.stopPropagation()
            setIsExpanded(true)
          }}
        >
          <span className="w-10 h-10 rounded-lg flex items-center justify-center font-mono text-xs text-[var(--fg-2)]" style={{ background: "var(--raise)" }}>
            +{remainingCount}
          </span>
          <span className="flex-1 min-w-0 text-[14px] font-medium text-[var(--fg-2)] hover:text-[var(--fg)]">
            View all tracks
          </span>
        </button>
      )}
    </div>
  )
})
