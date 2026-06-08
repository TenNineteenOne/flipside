"use client"

import { memo, useCallback } from "react"
import Image from "next/image"
import { motion } from "framer-motion"
import { SkipForward, Bookmark, Check, Share2 } from "lucide-react"
import { toast } from "sonner"
import { TrackStrip } from "@/components/feed/track-strip"
import { PlatformIcon } from "@/components/platform-icon"
import { useAudio } from "@/lib/audio-context"
import { hexToRgba } from "@/lib/color-utils"
import { useArtistTracks } from "@/lib/hooks/use-artist-tracks"
import { useArtistColor } from "@/lib/hooks/use-artist-color"
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
  spotifyId?: string | null
  name: string
  genres: string[]
  imageUrl: string | null
  popularity: number
  topTracks: Track[]
}

interface Recommendation {
  artist_id: string
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
  isSaved?: boolean
  /**
   * Last signal received for this artist. Drives both the collapsed dismiss
   * state and the in-place "Liked" affordance:
   *   - null           → expanded card, default buttons
   *   - "thumbs_up"    → expanded card, green outline + "Liked" button (keep playing)
   *   - "thumbs_down"  → collapsed 56px bar, red-tinted "Passed"
   *   - "skip"         → collapsed 56px bar, neutral "Dismissed"
   */
  dismissSignal?: string | null
  /** When true, hero image is preloaded (set on the LCP card only). */
  priority?: boolean
}

// ---------------------------------------------------------------------------
// Module-scope static styles — hoisted out of the render path. Each object
// here has zero prop/state references; dynamic styles stay inline below.
// ---------------------------------------------------------------------------

const heroWrapStyle: React.CSSProperties = {
  position: "relative",
  height: 340,
  overflow: "hidden",
}

const heroScrimStyle: React.CSSProperties = {
  position: "absolute",
  inset: 0,
  background: "linear-gradient(to top, #000 0%, transparent 65%)",
}

const heroNameWrapStyle: React.CSSProperties = {
  position: "absolute",
  left: 24,
  right: 24,
  bottom: 20,
}

const cardBodyStyle: React.CSSProperties = {
  padding: "18px 20px 20px",
}

const noTracksPlaceholderStyle: React.CSSProperties = {
  height: 64,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  borderRadius: 12,
  background: "rgba(255,255,255,0.025)",
  border: "1px solid var(--border)",
}

const reasonPillStyle: React.CSSProperties = {
  marginTop: 18,
  padding: "14px 16px",
  background: "rgba(255,255,255,0.025)",
  borderRadius: 12,
  fontSize: 14,
  textAlign: "center",
  color: "var(--text-secondary)",
  lineHeight: 1.4,
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

// Collapse the card for thumbs_down / skip, but NOT thumbs_up — we keep the
// card visible after a like so the user can keep listening. Bookmark no
// longer dismisses: saves only toggle the bookmark icon.
function signalCollapses(signal: string | null | undefined): boolean {
  return signal != null && signal !== "thumbs_up"
}

function ArtistCardImpl({
  recommendation,
  musicPlatform,
  onSave,
  onFeedback,
  isSaved = false,
  dismissSignal = null,
  priority = false,
}: ArtistCardProps) {
  const isLiked = dismissSignal === "thumbs_up"
  const isCollapsed = signalCollapses(dismissSignal)
  const { artist_data, why, artist_color } = recommendation
  const artistColor = useArtistColor(artist_color, artist_data.name)

  const { play } = useAudio()

  const { tracks: localTracks, isFetching: isFetchingTracks } = useArtistTracks({
    // The Show-Tracks route (/api/artists/[id]/tracks) is keyed on the internal
    // artist_id (Stage 2 re-key), so pass the surrogate uuid here.
    artistId: recommendation.artist_id,
    artistName: artist_data.name,
    initialTracks: artist_data.topTracks,
  })

  function handleSave(e: React.MouseEvent) {
    e.stopPropagation()
    onSave()
  }

  const handlePlay = useCallback(
    (track: Track) => {
      play(track, artist_data.name, artist_data.imageUrl, artistColor)
    },
    [play, artist_data.name, artist_data.imageUrl, artistColor],
  )

  function handleShare(e: React.MouseEvent) {
    e.stopPropagation()
    const url = getShareableArtistLink(musicPlatform, {
      artistId: recommendation.artist_id,
      spotifyId: artist_data.spotifyId ?? null,
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
  // Collapsed (slim bar) state — no emoji, colour-coded labels. Only applies
  // to thumbs_down / skip. Thumbs_up and saves keep the card expanded.
  // ------------------------------------------------------------------
  if (isCollapsed) {
    const labelMap: Record<string, { text: string; color: string; border: string }> = {
      thumbs_down: { text: "Passed",    color: "var(--dislike)",    border: "rgba(255,75,75,0.35)" },
      skip:        { text: "Dismissed", color: "var(--text-muted)", border: "var(--border)" },
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
          border: `1px solid ${signal.border}`,
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
  // Expanded hero card (also rendered after thumbs_up — card stays visible so
  // the user can keep playing tracks. The 'liked' affordance is a subtle green
  // outline + glow + the + More like this button swapping to ✓ Liked.)
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
        border: isLiked
          ? "2px solid rgba(34,197,94,0.55)"
          : "1px solid rgba(255,255,255,0.08)",
        boxShadow: isLiked
          ? "0 0 0 4px rgba(34,197,94,0.12), 0 30px 80px rgba(0,0,0,0.55)"
          : "0 30px 80px rgba(0,0,0,0.55)",
        transition: "border-color 0.25s ease, box-shadow 0.25s ease",
      }}
    >
      {/* Hero image */}
      <div style={heroWrapStyle}>
        {artist_data.imageUrl ? (
          <Image
            src={artist_data.imageUrl}
            alt={artist_data.name}
            fill
            sizes="(min-width: 900px) 680px, 100vw"
            priority={priority}
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
        <div style={heroScrimStyle} />

        {/* Name + genre */}
        <div style={heroNameWrapStyle}>
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
          {(artist_data.genres?.length ?? 0) > 0 && artist_data.genres?.[0] && (
            <div
              className="mono"
              style={{
                fontSize: 10.5,
                fontWeight: 600,
                letterSpacing: "0.2em",
                textTransform: "uppercase",
                color: artistColor,
                marginTop: 10,
              }}
            >
              {artist_data.genres[0]} · popularity {artist_data.popularity}
            </div>
          )}
        </div>
      </div>

      {/* Body */}
      <div style={cardBodyStyle}>
        {/* Track strip */}
        {localTracks.length > 0 ? (
          <div onClick={(e) => e.stopPropagation()}>
            <TrackStrip
              tracks={localTracks}
              artistId={recommendation.artist_id}
              artistName={artist_data.name}
              artistColor={artistColor}
              onPlay={handlePlay}
            />
          </div>
        ) : (
          <div style={noTracksPlaceholderStyle}>
            <span className="mono" style={{ fontSize: 11, color: "var(--text-muted)" }}>
              {isFetchingTracks ? "Loading tracks…" : "No tracks available"}
            </span>
          </div>
        )}

        {reasonText && (
          <div style={reasonPillStyle}>
            {reasonText}
          </div>
        )}

        {/* Actions */}
        <div className="col gap-12" style={{ marginTop: 16 }}>
          {/* Open in <preferred platform> + Share */}
          <div style={{ display: "flex", gap: 8 }}>
            <a
              href={getArtistLink(musicPlatform, {
                artistId: recommendation.artist_id,
                spotifyId: artist_data.spotifyId ?? null,
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
              <SkipForward size={15} /> Dismiss
            </button>
            <button
              onClick={() => onFeedback("thumbs_up")}
              aria-pressed={isLiked}
              className="btn"
              style={{
                flex: 1.2,
                minWidth: 0,
                fontSize: 13,
                whiteSpace: "nowrap",
                color: "var(--like)",
                background: isLiked ? "rgba(34,197,94,0.22)" : "rgba(34,197,94,0.07)",
                borderColor: isLiked ? "rgba(34,197,94,0.55)" : "rgba(34,197,94,0.22)",
                fontWeight: isLiked ? 700 : undefined,
              }}
            >
              {isLiked ? (
                <>
                  <Check size={15} strokeWidth={2.5} /> Liked
                </>
              ) : (
                <>
                  <span className="mono" style={{ fontSize: 13, fontWeight: 700 }}>+</span>{" "}
                  More like this
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </motion.div>
  )
}

// Memoized so that toggling a save on one card doesn't re-render every
// sibling in the feed. Props are all primitives plus two callbacks that
// FeedClient stabilizes per-artistId via its FeedCardRow wrapper.
export const ArtistCard = memo(ArtistCardImpl)
