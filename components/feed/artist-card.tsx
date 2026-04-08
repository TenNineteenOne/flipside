"use client"

import { useState } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { TrackStrip } from "@/components/feed/track-strip"
import { useAudio } from "@/lib/audio-context"
import type { Track } from "@/lib/music-provider/types"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

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
  // Extended for Issue 10 — artist_color comes from DB; null → purple fallback
  artist_color?: string | null
}

export interface ArtistCardProps {
  recommendation: Recommendation
  onOpen: () => void
  onSave: () => void
  onDismiss: () => void
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ArtistCard({ recommendation, onOpen, onSave, onDismiss }: ArtistCardProps) {
  const { artist_data, why, artist_color } = recommendation
  const artistColor = artist_color ?? "#8b5cf6"

  const [collapsed, setCollapsed] = useState(false)

  const { play } = useAudio()

  function handleDismiss(e: React.MouseEvent) {
    e.stopPropagation()
    setCollapsed(true)
    onDismiss()
  }

  function handleUndo(e: React.MouseEvent) {
    e.stopPropagation()
    setCollapsed(false)
  }

  function handleSave(e: React.MouseEvent) {
    e.stopPropagation()
    onSave()
  }

  function handlePlay(track: Track) {
    play(track, artist_data.name, artist_data.imageUrl, artistColor)
  }

  const reasonText = why.sourceArtists.length > 0
    ? `Because you listen to ${why.sourceArtists.join(" and ")}${why.genres.length > 0 ? " · " + why.genres.join(", ") : ""}`
    : why.genres.length > 0
      ? `Because you love ${why.genres.join(", ")}`
      : null

  // ------------------------------------------------------------------
  // Collapsed (slim bar) state
  // ------------------------------------------------------------------
  if (collapsed) {
    return (
      <motion.div
        layout
        initial={{ height: "auto", opacity: 1 }}
        animate={{ height: 48, opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ type: "spring", stiffness: 400, damping: 40 }}
        style={{
          width: "100%",
          background: "var(--bg-card)",
          border: "1px solid var(--border)",
          borderRadius: 12,
          overflow: "hidden",
          display: "flex",
          alignItems: "center",
          padding: "0 14px",
          gap: 8,
          cursor: "default",
        }}
      >
        {/* Artist name */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <span
            style={{
              fontSize: 12,
              fontFamily: "Inter, sans-serif",
              fontWeight: 500,
              color: "var(--text-secondary)",
              display: "block",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {artist_data.name}
          </span>
          <span
            style={{
              fontSize: 9,
              fontFamily: "Inter, sans-serif",
              fontWeight: 400,
              color: "var(--text-muted)",
            }}
          >
            Not for me
          </span>
        </div>

        {/* Undo button */}
        <button
          onClick={handleUndo}
          style={{
            background: "transparent",
            border: "1px solid var(--border)",
            color: "var(--text-muted)",
            fontSize: 10,
            fontFamily: "Inter, sans-serif",
            height: 26,
            padding: "0 10px",
            borderRadius: 6,
            cursor: "pointer",
            flexShrink: 0,
          }}
        >
          Undo
        </button>
      </motion.div>
    )
  }

  // ------------------------------------------------------------------
  // Expanded (full) state
  // ------------------------------------------------------------------
  return (
    <motion.div
      layout
      initial={false}
      animate={{ height: "auto", opacity: 1 }}
      transition={{ type: "spring", stiffness: 400, damping: 40 }}
      onClick={onOpen}
      style={{
        width: "100%",
        background: "var(--bg-card)",
        border: "1px solid var(--border)",
        borderRadius: 12,
        overflow: "hidden",
        cursor: "pointer",
      }}
    >
      {/* 1. Hero image area */}
      <div
        style={{
          position: "relative",
          height: 200,
          overflow: "hidden",
        }}
      >
        {artist_data.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={artist_data.imageUrl}
            alt={artist_data.name}
            style={{
              width: "100%",
              height: "100%",
              objectFit: "cover",
              display: "block",
            }}
          />
        ) : (
          <div
            style={{
              width: "100%",
              height: "100%",
              background: "#1a1a1a",
            }}
          />
        )}

        {/* Gradient overlay */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            background: "linear-gradient(to top, #0f0f0f 0%, transparent 60%)",
          }}
        />

        {/* Bottom-left: genre tag + artist name */}
        <div
          style={{
            position: "absolute",
            bottom: 0,
            left: 0,
            padding: 12,
          }}
        >
          {artist_data.genres.length > 0 && (
            <div
              style={{
                fontSize: 8,
                fontFamily: "Inter, sans-serif",
                fontWeight: 600,
                textTransform: "uppercase",
                letterSpacing: "0.18em",
                color: artistColor,
                marginBottom: 4,
              }}
            >
              {artist_data.genres[0]}
            </div>
          )}
          <div
            style={{
              fontFamily: "var(--font-display), 'Space Grotesk', sans-serif",
              fontWeight: 700,
              fontSize: "clamp(22px, 5vw, 28px)",
              color: "var(--text-primary)",
              letterSpacing: "-0.02em",
              lineHeight: 1.1,
            }}
          >
            {artist_data.name}
          </div>
        </div>
      </div>

      {/* 2. Card body */}
      <div style={{ padding: "12px 14px", display: "flex", flexDirection: "column", gap: 8 }}>
        {/* Reason text */}
        {reasonText && (
          <div
            style={{
              fontSize: 10,
              fontFamily: "Inter, sans-serif",
              fontWeight: 400,
              color: "var(--text-muted)",
              display: "-webkit-box",
              WebkitLineClamp: 2,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
            }}
          >
            {reasonText}
          </div>
        )}

        {/* Genre pills */}
        {artist_data.genres.length > 0 && (
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: 4,
            }}
          >
            {artist_data.genres.slice(0, 5).map((genre) => (
              <span
                key={genre}
                style={{
                  fontSize: 8,
                  fontFamily: "Inter, sans-serif",
                  fontWeight: 500,
                  textTransform: "uppercase",
                  background: "#141414",
                  border: "1px solid #1e1e1e",
                  color: "#444",
                  padding: "3px 7px",
                  borderRadius: 4,
                }}
              >
                {genre}
              </span>
            ))}
          </div>
        )}

        {/* TrackStrip */}
        {artist_data.topTracks.length > 0 && (
          <div onClick={(e) => e.stopPropagation()}>
            <TrackStrip
              tracks={artist_data.topTracks}
              artistColor={artistColor}
              onOpen={onOpen}
              onPlay={handlePlay}
            />
          </div>
        )}
      </div>

      {/* 3. Action row */}
      <div
        style={{
          padding: "0 14px 14px",
          display: "flex",
          gap: 8,
        }}
      >
        {/* Not for me */}
        <button
          onClick={handleDismiss}
          style={{
            flex: 1,
            background: "transparent",
            border: "1px solid rgba(255,255,255,0.08)",
            color: "var(--text-muted)",
            fontSize: 11,
            fontFamily: "Inter, sans-serif",
            height: 30,
            borderRadius: 8,
            cursor: "pointer",
          }}
        >
          👎 Not for me
        </button>

        {/* Save */}
        <button
          onClick={handleSave}
          style={{
            flex: 1,
            background: artistColor,
            border: "none",
            color: "#000",
            fontSize: 11,
            fontFamily: "Inter, sans-serif",
            fontWeight: 600,
            height: 30,
            borderRadius: 8,
            cursor: "pointer",
          }}
        >
          + Save
        </button>
      </div>
    </motion.div>
  )
}
