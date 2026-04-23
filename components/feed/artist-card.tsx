"use client"

import { useState, useEffect, useMemo } from "react"
import Image from "next/image"
import { motion } from "framer-motion"
import { SkipForward, Bookmark, Check, Share2 } from "lucide-react"
import { toast } from "sonner"
import { TrackStrip } from "@/components/feed/track-strip"
import { PlatformIcon } from "@/components/platform-icon"
import { useAudio } from "@/lib/audio-context"
import { stringToVibrantHex, hexToRgba, sanitizeHex } from "@/lib/color-utils"
import type { Track } from "@/lib/music-provider/types"
import {
  PLATFORM_META,
  getArtistLink,
  getShareableArtistLink,
  type MusicPlatform,
} from "@/lib/music-links"

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
  musicPlatform: MusicPlatform
  onSave: () => void
  onFeedback: (signal: string) => void
  isDismissed?: boolean
  isSaved?: boolean
  dismissSignal?: string | null
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ArtistCard({
  recommendation,
  musicPlatform,
  onSave,
  onFeedback,
  isDismissed = false,
  isSaved = false,
  dismissSignal = null,
}: ArtistCardProps) {
  const { artist_data, why, artist_color } = recommendation
  const artistColor = useMemo(() => {
    const c = sanitizeHex(artist_color)
    if (c === "#8b5cf6") return stringToVibrantHex(artist_data.name)
    return c
  }, [artist_color, artist_data.name])

  const { play } = useAudio()

  const [localTracks, setLocalTracks] = useState<Track[]>(artist_data.topTracks)
  const [isFetchingTracks, setIsFetchingTracks] = useState(false)

  useEffect(() => {
    if (artist_data.topTracks.length === 0 && localTracks.length === 0 && !isFetchingTracks) {
      const ctrl = new AbortController()
      setIsFetchingTracks(true)
      fetch(
        `/api/artists/${recommendation.spotify_artist_id}/tracks?name=${encodeURIComponent(artist_data.name)}`,
        { signal: ctrl.signal },
      )
        .then((r) => {
          if (!r.ok) throw new Error("fetch failed")
          return r.json()
        })
        .then((data) => {
          if (ctrl.signal.aborted) return
          if (data.tracks?.length > 0) setLocalTracks(data.tracks)
        })
        .catch((err: unknown) => {
          if (err instanceof DOMException && err.name === "AbortError") return
          // Silent — user still sees "No tracks available" fallback.
        })
        .finally(() => {
          if (!ctrl.signal.aborted) setIsFetchingTracks(false)
        })
      return () => ctrl.abort()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only fetch once when tracks are empty
  }, [artist_data.topTracks.length, artist_data.name, recommendation.spotify_artist_id])

  function handleSave(e: React.MouseEvent) {
    e.stopPropagation()
    onSave()
  }

  function handlePlay(track: Track) {
    play(track, artist_data.name, artist_data.imageUrl, artistColor)
  }

  function handleShare(e: React.MouseEvent) {
    e.stopPropagation()
    const url = getShareableArtistLink(musicPlatform, {
      spotifyArtistId: recommendation.spotify_artist_id,
      artistName: artist_data.name,
    })
    navigator.clipboard.writeText(url).then(() => toast.success("Link copied!")).catch(() => toast.error("Couldn't copy link"))
  }

  const reasonText =
    why.sourceArtists.length > 0
      ? why.genres.length > 0
        ? `Similar to ${why.sourceArtists.join(" & ")} · genre · ${why.genres[0]}`
        : `Similar to ${why.sourceArtists.join(" & ")}`
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
          <Image
            src={artist_data.imageUrl}
            alt={artist_data.name}
            fill
            sizes="(min-width: 900px) 680px, 100vw"
            style={{
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
          {(artist_data.genres?.length ?? 0) > 0 && artist_data.genres?.[0] && (
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
              {artist_data.genres[0]} · popularity {artist_data.popularity}
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

        {reasonText && (
          <div
            style={{
              marginTop: 18,
              padding: "14px 16px",
              background: "rgba(255,255,255,0.025)",
              borderRadius: 12,
              fontSize: 14,
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
          {/* Open in <preferred platform> + Share */}
          <div style={{ display: "flex", gap: 8 }}>
            <a
              href={getArtistLink(musicPlatform, {
                spotifyArtistId: recommendation.spotify_artist_id,
                artistName: artist_data.name,
              })}
              target="_blank"
              rel="noopener noreferrer"
              className="btn"
              onClick={(e) => e.stopPropagation()}
              style={{
                flex: 1,
                background: PLATFORM_META[musicPlatform].brandColor,
                color: PLATFORM_META[musicPlatform].brandFg,
                borderColor: "transparent",
                fontWeight: 700,
              }}
            >
              <PlatformIcon platform={musicPlatform} size={16} />
              Open in {PLATFORM_META[musicPlatform].label}
            </a>
            <button
              className="btn"
              onClick={handleShare}
              title="Copy artist link"
              style={{ padding: "0 14px" }}
            >
              <Share2 size={15} />
            </button>
          </div>

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
                minWidth: 0,
                fontSize: 13,
                whiteSpace: "nowrap",
                color: "#ff7b7b",
                background: "rgba(255,75,75,0.05)",
                borderColor: "rgba(255,75,75,0.18)",
              }}
            >
              <span className="mono" style={{ fontSize: 13, fontWeight: 700 }}>
                —
              </span>{" "}
              Less like this
            </button>
            <button
              onClick={() => onFeedback("skip")}
              className="btn"
              style={{ flex: 1, minWidth: 0, fontSize: 13, whiteSpace: "nowrap" }}
            >
              <SkipForward size={15} /> Later
            </button>
            <button
              onClick={() => onFeedback("thumbs_up")}
              className="btn"
              style={{
                flex: 1.2,
                minWidth: 0,
                fontSize: 13,
                whiteSpace: "nowrap",
                color: "var(--like)",
                background: "rgba(34,197,94,0.07)",
                borderColor: "rgba(34,197,94,0.22)",
              }}
            >
              <span className="mono" style={{ fontSize: 13, fontWeight: 700 }}>
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
