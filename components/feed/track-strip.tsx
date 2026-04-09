"use client"

import Image from "next/image"
import { Play } from "lucide-react"
import type { Track } from "@/lib/music-provider/types"

// ---------------------------------------------------------------------------
// Hex → RGB helper
// ---------------------------------------------------------------------------

function hexToRgba(hex: string, alpha: number): string {
  const cleaned = hex.replace(/^#/, "")
  const full =
    cleaned.length === 3
      ? cleaned
          .split("")
          .map((c) => c + c)
          .join("")
      : cleaned

  const num = parseInt(full.slice(0, 6), 16)
  const r = (num >> 16) & 0xff
  const g = (num >> 8) & 0xff
  const b = num & 0xff

  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface TrackStripProps {
  tracks: Track[]
  artistColor?: string       // hex, defaults to '#8b5cf6'
  compact?: boolean          // Optional for dense UI views like Saved screen
  onPlay?: (track: Track) => void
  onOpen?: () => void        // tapping the strip opens the drawer
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function TrackStrip({
  tracks,
  artistColor = "#8b5cf6",
  compact = false,
  onPlay,
  onOpen,
}: TrackStripProps) {
  if (tracks.length === 0) return null

  // Option 11 CSS classes for hover states
  const baseTintFlow = `linear-gradient(90deg, ${hexToRgba(artistColor, 0.25)} 0%, rgba(15,15,15,0.7) 100%)`

  const handlePlayClick = (e: React.MouseEvent, track: Track) => {
    e.stopPropagation()
    onPlay?.(track)
    onOpen?.()
  }

  // Define how many tracks show. In feed, maybe show 3 maximum to prevent overwhelming the card.
  const displayTracks = compact ? tracks.slice(0, 1) : tracks.slice(0, 3)
  const remainingCount = tracks.length - displayTracks.length

  return (
    <div className="flex flex-col gap-[3px] mt-2 mb-2 px-1 w-full" onClick={onOpen}>
      {displayTracks.map((track, index) => {
        const isFeatured = index === 0 && !compact

        // For the first track, it gets the largest treatment
        if (isFeatured) {
          return (
            <div
              key={track.id}
              onClick={(e) => { e.stopPropagation(); onOpen?.() }}
              className="rounded-r-2xl p-3 flex items-center gap-4 cursor-pointer transition-transform hover:translate-x-1"
              style={{
                background: baseTintFlow,
                borderLeft: `3px solid ${artistColor}`
              }}
            >
              <div className="relative w-12 h-12 shrink-0">
                {track.albumImageUrl ? (
                  <Image
                    src={track.albumImageUrl}
                    alt={track.albumName}
                    width={48}
                    height={48}
                    className="rounded-lg object-cover shadow-lg w-full h-full"
                    unoptimized
                  />
                ) : (
                  <div className="w-full h-full bg-black/40 rounded-lg" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[16px] font-bold text-white truncate drop-shadow-sm">
                  {track.name}
                </div>
                {/* Secondary artist mapping (safeguard missing values) */}
                <div className="text-[13px] text-white/50 mt-0.5 truncate mix-blend-plus-lighter font-medium">
                  {track.albumName}
                </div>
              </div>
              <button
                onClick={(e) => handlePlayClick(e, track)}
                className="w-10 h-10 rounded-full text-black flex items-center justify-center shrink-0 border-none transition-transform hover:scale-105"
                style={{ backgroundColor: artistColor }}
                aria-label={`Play ${track.name}`}
              >
                <Play size={16} fill="currentColor" strokeWidth={0} />
              </button>
            </div>
          )
        }

        // Secondary tracks
        return (
          <div
            key={track.id}
            onClick={(e) => { e.stopPropagation(); onOpen?.() }}
            className="rounded-r-2xl p-2.5 flex items-center gap-4 cursor-pointer transition-transform hover:translate-x-1"
            style={{
              background: baseTintFlow,
              borderLeft: `3px solid ${artistColor}`
            }}
          >
            <div className="relative w-10 h-10 shrink-0">
               {track.albumImageUrl ? (
                 <Image
                   src={track.albumImageUrl}
                   alt={track.albumName}
                   width={40}
                   height={40}
                   className="rounded-lg object-cover opacity-80 w-full h-full"
                   unoptimized
                 />
               ) : (
                 <div className="w-full h-full bg-black/40 rounded-lg opacity-80" />
               )}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-[15px] font-semibold text-gray-200 truncate pr-2">
                {track.name}
              </div>
            </div>
            <button
                onClick={(e) => handlePlayClick(e, track)}
                className="w-8 h-8 rounded-full text-white flex items-center justify-center shrink-0 border border-white/20 transition-colors hover:bg-white hover:text-black"
                aria-label={`Play ${track.name}`}
              >
                <Play size={12} fill="currentColor" strokeWidth={0} />
              </button>
          </div>
        )
      })}

      {/* Overflow tracking "+ X tracks" */}
      {remainingCount > 0 && !compact && (
        <div
          className="rounded-r-2xl p-2.5 flex items-center gap-4 cursor-pointer transition-transform hover:translate-x-1"
          style={{
            background: baseTintFlow,
            borderLeft: `3px solid ${artistColor}`
          }}
          onClick={(e) => { e.stopPropagation(); onOpen?.() }}
        >
          <div className="w-10 h-10 bg-black/30 rounded-lg flex items-center justify-center border border-white/5 opacity-80 text-gray-400 font-semibold text-xs">
            +{remainingCount}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-[14px] font-medium text-gray-400 italic hover:text-gray-200 transition-colors">
              View all tracks
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
