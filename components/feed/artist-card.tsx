"use client"

import { useState, useEffect, useMemo } from "react"
import { motion } from "framer-motion"
import { SkipForward, Bookmark, Check } from "lucide-react"
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
  artist_color?: string | null
}

export interface ArtistCardProps {
  recommendation: Recommendation
  onSave: () => void
  onFeedback: (signal: string) => void
  isDismissed?: boolean
  isSaved?: boolean
  dismissSignal?: string | null
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function stringToVibrantHex(str: string): string {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash)
  }
  const hue = Math.abs(hash) % 360
  const s = 0.70
  const l = 0.65
  const c = (1 - Math.abs(2 * l - 1)) * s
  const x = c * (1 - Math.abs((hue / 60) % 2 - 1))
  const m = l - c / 2
  let r = 0, g = 0, b = 0
  if (hue < 60)        { r = c; g = x; b = 0 }
  else if (hue < 120)  { r = x; g = c; b = 0 }
  else if (hue < 180)  { r = 0; g = c; b = x }
  else if (hue < 240)  { r = 0; g = x; b = c }
  else if (hue < 300)  { r = x; g = 0; b = c }
  else                 { r = c; g = 0; b = x }
  const toHex = (n: number) => {
    const hex = Math.round((n + m) * 255).toString(16)
    return hex.length === 1 ? "0" + hex : hex
  }
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`
}

function hexToRgba(hex: string, alpha: number): string {
  const cleaned = hex.replace(/^#/, "")
  const full = cleaned.length === 3 ? cleaned.split("").map((c) => c + c).join("") : cleaned
  const num = parseInt(full.slice(0, 6), 16)
  return `rgba(${(num >> 16) & 0xff}, ${(num >> 8) & 0xff}, ${num & 0xff}, ${alpha})`
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ArtistCard({
  recommendation,
  onSave,
  onFeedback,
  isDismissed = false,
  isSaved = false,
  dismissSignal = null,
}: ArtistCardProps) {
  const { artist_data, why, artist_color } = recommendation
  const artistColor = useMemo(() => {
    const c = artist_color ?? "#8b5cf6"
    if (c.toLowerCase() === "#8b5cf6") return stringToVibrantHex(artist_data.name)
    return c
  }, [artist_color, artist_data.name])

  const { play } = useAudio()

  const [localTracks, setLocalTracks] = useState<Track[]>(artist_data.topTracks)
  const [isFetchingTracks, setIsFetchingTracks] = useState(false)

  useEffect(() => {
    if (artist_data.topTracks.length === 0 && localTracks.length === 0 && !isFetchingTracks) {
      setIsFetchingTracks(true)
      fetch(`/api/artists/${recommendation.spotify_artist_id}/tracks?name=${encodeURIComponent(artist_data.name)}`)
        .then((r) => r.json())
        .then((data) => {
          if (data.tracks?.length > 0) setLocalTracks(data.tracks)
        })
        .finally(() => setIsFetchingTracks(false))
    }
  }, [artist_data.topTracks.length, artist_data.name, recommendation.spotify_artist_id])

  function handleSave(e: React.MouseEvent) {
    e.stopPropagation()
    onSave()
  }

  function handlePlay(track: Track) {
    play(track, artist_data.name, artist_data.imageUrl, artistColor)
  }

  const reasonText =
    why.sourceArtists.length > 0
      ? `Similar to ${why.sourceArtists.join(" & ")}`
      : why.genres.length > 0
        ? `Because you like ${why.genres.join(", ")}`
        : null

  // ------------------------------------------------------------------
  // Collapsed (slim bar) state — no emoji, colour-coded labels
  // ------------------------------------------------------------------
  if (isDismissed) {
    const labelMap: Record<string, { text: string; color: string }> = {
      thumbs_up:   { text: "Liked",       color: "var(--like)"     },
      thumbs_down: { text: "Passed",      color: "var(--dislike)"  },
      skip:        { text: "Maybe later", color: "var(--text-muted)" },
      saved:       { text: "Saved",       color: "var(--accent)"   },
    }
    const signal = labelMap[dismissSignal ?? "skip"] ?? labelMap.skip

    return (
      <motion.div
        layout
        initial={{ height: "auto", opacity: 1 }}
        animate={{ height: 56, opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ type: "spring", stiffness: 400, damping: 40 }}
        style={{
          padding: "14px 18px",
          background: "rgba(15,15,15,0.6)",
          border: "1px solid var(--border)",
          borderRadius: 16,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          overflow: "hidden",
        }}
      >
        <span style={{ fontSize: 14, fontWeight: 600, color: "var(--text-secondary)" }}>
          {artist_data.name}
        </span>
        <span
          className="mono"
          style={{
            fontSize: 11,
            fontWeight: 600,
            color: signal.color,
            textTransform: "uppercase",
            letterSpacing: "0.1em",
          }}
        >
          {signal.text}
        </span>
      </motion.div>
    )
  }

  // ------------------------------------------------------------------
  // Expanded hero card
  // ------------------------------------------------------------------
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 20 }}
      animate={{ height: "auto", opacity: 1, y: 0 }}
      transition={{ type: "spring", stiffness: 400, damping: 40 }}
      className="fadein"
      style={{
        width: "100%",
        borderRadius: "var(--radius-xl)",
        overflow: "hidden",
        background: "rgba(15,15,15,0.65)",
        backdropFilter: "blur(30px)",
        WebkitBackdropFilter: "blur(30px)",
        border: "1px solid rgba(255,255,255,0.08)",
        boxShadow: "0 30px 80px rgba(0,0,0,0.55)",
      }}
    >
      {/* Hero image */}
      <div style={{ position: "relative", height: 340, overflow: "hidden" }}>
        {artist_data.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={artist_data.imageUrl}
            alt={artist_data.name}
            style={{
              width: "100%",
              height: "100%",
              objectFit: "cover",
              filter: "saturate(0.85) contrast(1.05)",
            }}
          />
        ) : (
          <div
            style={{
              width: "100%",
              height: "100%",
              background: `linear-gradient(135deg, ${hexToRgba(artistColor, 0.4)}, ${hexToRgba(artistColor, 0.15)} 60%, #0a0a0a)`,
            }}
          />
        )}

        {/* Color tint overlay */}
        {artist_data.imageUrl && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              background: `linear-gradient(135deg, ${hexToRgba(artistColor, 0.18)}, transparent 60%)`,
              mixBlendMode: "color",
            }}
          />
        )}

        {/* Dark gradient scrim */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            background: "linear-gradient(to top, #000 0%, transparent 65%)",
          }}
        />

        {/* Genre + name */}
        <div style={{ position: "absolute", left: 24, right: 24, bottom: 20 }}>
          {artist_data.genres.length > 0 && (
            <div
              className="mono"
              style={{
                fontSize: 10.5,
                fontWeight: 600,
                letterSpacing: "0.2em",
                textTransform: "uppercase",
                color: artistColor,
                marginBottom: 10,
              }}
            >
              {artist_data.genres[0]} · pop {artist_data.popularity}
            </div>
          )}
          <div
            className="display"
            style={{
              fontSize: "clamp(40px, 9vw, 56px)",
              lineHeight: 0.92,
              color: "#fff",
              textShadow: "0 4px 30px rgba(0,0,0,0.5)",
            }}
          >
            {artist_data.name}
          </div>
        </div>
      </div>

      {/* Body */}
      <div style={{ padding: "18px 20px 20px" }}>
        {/* Track strip */}
        {localTracks.length > 0 ? (
          <div onClick={(e) => e.stopPropagation()}>
            <TrackStrip
              tracks={localTracks}
              artistId={recommendation.spotify_artist_id}
              artistName={artist_data.name}
              artistColor={artistColor}
              onPlay={handlePlay}
            />
          </div>
        ) : (
          <div
            style={{
              height: 64,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              borderRadius: 12,
              background: "rgba(255,255,255,0.025)",
              border: "1px solid var(--border)",
            }}
          >
            <span className="mono" style={{ fontSize: 11, color: "var(--text-muted)" }}>
              {isFetchingTracks ? "Loading tracks…" : "No tracks available"}
            </span>
          </div>
        )}

        {/* Reason / why */}
        {reasonText && (
          <div
            className="serif"
            style={{
              marginTop: 18,
              padding: "14px 16px",
              background: "rgba(255,255,255,0.025)",
              borderRadius: 12,
              fontSize: 15,
              textAlign: "center",
              color: "var(--text-secondary)",
              lineHeight: 1.4,
            }}
          >
            {reasonText}
          </div>
        )}

        {/* Actions */}
        <div className="col gap-12" style={{ marginTop: 16 }}>
          {/* Spotify */}
          <a
            href={`https://open.spotify.com/artist/${recommendation.spotify_artist_id}`}
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn-spotify btn-block"
            onClick={(e) => e.stopPropagation()}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z"/>
            </svg>
            Open in Spotify
          </a>

          {/* Bookmark */}
          <button
            className="btn btn-block btn-lg"
            onClick={handleSave}
            style={{
              background: isSaved ? "rgba(255,255,255,0.04)" : hexToRgba(artistColor, 0.15),
              borderColor: isSaved ? "var(--border)" : hexToRgba(artistColor, 0.35),
              color: isSaved ? "var(--text-muted)" : "var(--text-primary)",
              fontWeight: 600,
            }}
          >
            {isSaved ? (
              <>
                <Check size={16} strokeWidth={2.5} /> Bookmarked
              </>
            ) : (
              <>
                <Bookmark size={16} /> Bookmark in Flipside
              </>
            )}
          </button>

          {/* Feedback strip — NO EMOJI */}
          <div style={{ display: "flex", gap: 10 }}>
            <button
              onClick={() => onFeedback("thumbs_down")}
              className="btn"
              style={{
                flex: 1,
                color: "#ff7b7b",
                background: "rgba(255,75,75,0.05)",
                borderColor: "rgba(255,75,75,0.18)",
              }}
            >
              <span className="mono" style={{ fontSize: 13, fontWeight: 700, letterSpacing: "0.04em" }}>
                —
              </span>{" "}
              Less like this
            </button>
            <button
              onClick={() => onFeedback("skip")}
              className="btn"
              style={{ flex: 1 }}
            >
              <SkipForward size={15} /> Later
            </button>
            <button
              onClick={() => onFeedback("thumbs_up")}
              className="btn"
              style={{
                flex: 1.2,
                color: "var(--like)",
                background: "rgba(34,197,94,0.07)",
                borderColor: "rgba(34,197,94,0.22)",
              }}
            >
              <span className="mono" style={{ fontSize: 13, fontWeight: 700, letterSpacing: "0.04em" }}>
                +
              </span>{" "}
              More like this
            </button>
          </div>
        </div>
      </div>
    </motion.div>
  )
}
