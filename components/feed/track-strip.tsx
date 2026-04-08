"use client"

import Image from "next/image"
import { Play } from "lucide-react"
import type { Track } from "@/lib/music-provider/types"

// ---------------------------------------------------------------------------
// Hex → RGB helper
// ---------------------------------------------------------------------------

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  // Normalise shorthand (#abc → #aabbcc)
  const cleaned = hex.replace(/^#/, "")
  const full =
    cleaned.length === 3
      ? cleaned
          .split("")
          .map((c) => c + c)
          .join("")
      : cleaned

  const num = parseInt(full.slice(0, 6), 16)
  return {
    r: (num >> 16) & 0xff,
    g: (num >> 8) & 0xff,
    b: num & 0xff,
  }
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface TrackStripProps {
  tracks: Track[]
  artistColor?: string       // hex, defaults to '#8b5cf6'
  compact?: boolean          // 16×16 thumbnails, smaller text — for Saved screen
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

  const { r, g, b } = hexToRgb(artistColor)

  const bgStyle: React.CSSProperties = {
    margin: "7px 10px 9px",
    borderRadius: 10,
    padding: "9px 11px",
    background: `rgba(${r},${g},${b},0.09)`,
    border: `1px solid rgba(${r},${g},${b},0.22)`,
    display: "flex",
    alignItems: "center",
    gap: 10,
    cursor: "pointer",
    userSelect: "none",
  }

  // Thumbnail dimensions
  const thumbSize = compact ? 16 : 26
  const thumbRadius = compact ? 3 : 5

  // Play button dimensions
  const btnSize = compact ? 22 : 28
  const playIconSize = compact ? 10 : 14

  // Text sizes
  const trackNameFontSize = compact ? 9 : 11
  const countFontSize = compact ? 8 : 9

  // Show up to 3 thumbnails
  const thumbnailTracks = tracks.slice(0, 3)

  const featuredTrack = tracks[0]
  const remainingCount = tracks.length - 1

  function handleStripClick() {
    onOpen?.()
  }

  function handlePlayClick(e: React.MouseEvent) {
    e.stopPropagation()
    onPlay?.(featuredTrack)
    onOpen?.()
  }

  return (
    <div style={bgStyle} onClick={handleStripClick}>
      {/* Stacked album art thumbnails */}
      <div style={{ display: "flex", alignItems: "center", flexShrink: 0 }}>
        {thumbnailTracks.map((track, index) => (
          <div
            key={track.id}
            style={{
              width: thumbSize,
              height: thumbSize,
              borderRadius: thumbRadius,
              border: "2px solid #080808",
              overflow: "hidden",
              flexShrink: 0,
              backgroundColor: "#2a2a2a",
              // Each thumbnail after the first overlaps the previous by 8px
              marginLeft: index === 0 ? 0 : -8,
              // Higher z-index so each new thumbnail sits on top
              position: "relative",
              zIndex: index,
            }}
          >
            {track.albumImageUrl ? (
              <Image
                src={track.albumImageUrl}
                alt={track.albumName}
                width={thumbSize}
                height={thumbSize}
                style={{ objectFit: "cover", width: "100%", height: "100%" }}
                unoptimized
              />
            ) : (
              // Grey placeholder when no album art
              <div
                style={{
                  width: "100%",
                  height: "100%",
                  backgroundColor: "#333",
                }}
              />
            )}
          </div>
        ))}
      </div>

      {/* Centre text column */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          flex: 1,
          minWidth: 0,
          gap: 2,
        }}
      >
        <span
          style={{
            fontSize: trackNameFontSize,
            fontFamily: "Inter, sans-serif",
            fontWeight: 500,
            color: "#dddddd",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {tracks.length > 1 ? `▶ ${featuredTrack.name}` : featuredTrack.name}
        </span>
        <span
          style={{
            fontSize: countFontSize,
            fontFamily: "Inter, sans-serif",
            fontWeight: 400,
            color: "#444444",
          }}
        >
          {tracks.length === 1
            ? "1 track"
            : `+ ${remainingCount} more track${remainingCount === 1 ? "" : "s"}`}
        </span>
      </div>

      {/* Circular play button */}
      <button
        onClick={handlePlayClick}
        style={{
          width: btnSize,
          height: btnSize,
          borderRadius: "50%",
          background: artistColor,
          color: "#000",
          border: "none",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
          cursor: "pointer",
          padding: 0,
        }}
        aria-label={`Play ${featuredTrack.name}`}
      >
        <Play
          size={playIconSize}
          fill="currentColor"
          strokeWidth={0}
        />
      </button>
    </div>
  )
}
