"use client"

import { memo, useCallback } from "react"
import Image from "next/image"
import { motion } from "framer-motion"
import { Bookmark, Check, Heart, Share2, ThumbsDown, X } from "lucide-react"
import { toast } from "sonner"
import { TrackStrip } from "@/components/feed/track-strip"
import { PlatformIcon } from "@/components/platform-icon"
import { useAudio } from "@/lib/audio-context"
import { hexToRgba } from "@/lib/color-utils"
import { useArtistTracks } from "@/lib/hooks/use-artist-tracks"
import { useArtistColor } from "@/lib/hooks/use-artist-color"
import type { Track } from "@/lib/music-provider/types"
import type { CardArtist } from "@/lib/cards/card-artist"
import {
  PLATFORM_META,
  getArtistLink,
  getShareableArtistLink,
  type MusicPlatform,
} from "@/lib/music-links"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ArtistCardProps {
  artist: CardArtist
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
  padding: "16px 20px 20px",
}

const noTracksPlaceholderStyle: React.CSSProperties = {
  height: 64,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  borderRadius: 10,
  border: "1px solid var(--line)",
  fontSize: 13,
  color: "var(--fg-3)",
}

const reasonStyle: React.CSSProperties = {
  marginTop: 14,
  fontSize: 15,
  color: "var(--fg-2)",
  lineHeight: 1.45,
}

/** Evolved secondary / triage button (the desktop feed's .ev-tri look). */
const quietBtnStyle: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
  height: 44,
  padding: "0 10px",
  gap: 7,
  borderRadius: 9,
  border: "1px solid transparent",
  background: "var(--raise)",
  color: "var(--fg-2)",
  fontSize: 14,
  fontWeight: 550,
  whiteSpace: "nowrap",
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
  artist,
  musicPlatform,
  onSave,
  onFeedback,
  isSaved = false,
  dismissSignal = null,
  priority = false,
}: ArtistCardProps) {
  const isLiked = dismissSignal === "thumbs_up"
  const isCollapsed = signalCollapses(dismissSignal)
  const { why } = artist
  const artistColor = useArtistColor(artist.artistColor, artist.name)

  const { play } = useAudio()

  const { tracks: localTracks, isFetching: isFetchingTracks } = useArtistTracks({
    // The Show-Tracks route (/api/artists/[id]/tracks) is keyed on the internal
    // artist_id (Stage 2 re-key), so pass the surrogate uuid here.
    artistId: artist.id,
    artistName: artist.name,
    initialTracks: artist.topTracks,
  })

  function handleSave(e: React.MouseEvent) {
    e.stopPropagation()
    onSave()
  }

  const handlePlay = useCallback(
    (track: Track) => {
      play(track, artist.name, artist.imageUrl, artistColor)
    },
    [play, artist.name, artist.imageUrl, artistColor],
  )

  function handleShare(e: React.MouseEvent) {
    e.stopPropagation()
    const url = getShareableArtistLink(musicPlatform, {
      artistId: artist.id,
      spotifyId: artist.spotifyId ?? null,
      artistName: artist.name,
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
    const passed = dismissSignal === "thumbs_down"

    return (
      <motion.div
        layout
        exit={{ opacity: 0 }}
        transition={{ type: "spring", stiffness: 400, damping: 40 }}
        style={{
          height: 56,
          padding: "0 18px",
          background: "var(--panel)",
          border: "1px solid var(--line)",
          borderRadius: 12,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          overflow: "hidden",
        }}
      >
        <span style={{ fontSize: 15, fontWeight: 600, color: "var(--fg-2)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {artist.name}
        </span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6, flexShrink: 0, fontSize: 13, fontWeight: 600, color: "var(--fg-3)" }}>
          {passed ? <ThumbsDown size={14} aria-hidden /> : <X size={14} aria-hidden />}
          {passed ? "Passed" : "Dismissed"}
        </span>
      </motion.div>
    )
  }

  // ------------------------------------------------------------------
  // Expanded hero card (also rendered after thumbs_up — card stays visible so
  // the user can keep playing tracks. The 'liked' affordance is a violet
  // outline + the More like this button turning solid violet "Liked".)
  // ------------------------------------------------------------------
  return (
    <motion.div
      layout
      initial={{ y: 20 }}
      animate={{ y: 0 }}
      transition={{ type: "spring", stiffness: 400, damping: 40 }}
      style={{
        width: "100%",
        borderRadius: 16,
        overflow: "hidden",
        background: "var(--panel)",
        border: `1px solid ${isLiked ? "var(--violet)" : "var(--line)"}`,
        boxShadow: "0 12px 30px rgba(0,0,0,0.35)",
      }}
    >
      {/* Hero image */}
      <div style={heroWrapStyle}>
        {artist.imageUrl ? (
          <Image
            src={artist.imageUrl}
            alt={artist.name}
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
              background: `linear-gradient(135deg, ${hexToRgba(artistColor, 0.4)}, ${hexToRgba(artistColor, 0.15)} 60%, var(--panel))`,
            }}
          />
        )}

        {/* Colour tint: a plain gradient (no blend mode) */}
        {artist.imageUrl && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              background: `linear-gradient(135deg, ${hexToRgba(artistColor, 0.18)}, transparent 60%)`,
            }}
          />
        )}

        {/* Dark gradient scrim */}
        <div style={heroScrimStyle} />

        {/* Name + genre */}
        <div style={heroNameWrapStyle}>
          <h3
            style={{
              margin: 0,
              fontSize: "clamp(32px, 7vw, 40px)",
              fontWeight: 600,
              lineHeight: 1.05,
              letterSpacing: "-0.03em",
              color: "#fff",
              textShadow: "0 2px 16px rgba(0,0,0,0.5)",
            }}
          >
            {artist.name}
          </h3>
          {(artist.genres?.length ?? 0) > 0 && artist.genres?.[0] && (
            <div style={{ marginTop: 6, fontSize: 14, color: "rgba(255,255,255,0.82)" }}>
              {artist.genres[0]} · popularity {artist.popularity}
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
              artistColor={artistColor}
              onPlay={handlePlay}
            />
          </div>
        ) : (
          <div style={noTracksPlaceholderStyle}>
            {isFetchingTracks ? "Loading tracks…" : "No tracks available"}
          </div>
        )}

        {reasonText && (
          <p style={reasonStyle}>
            {reasonText}
          </p>
        )}

        {/* Actions */}
        <div className="col" style={{ gap: 10, marginTop: 16 }}>
          {/* Open in <preferred platform> + Share */}
          <div style={{ display: "flex", gap: 8 }}>
            <a
              href={getArtistLink(musicPlatform, {
                artistId: artist.id,
                spotifyId: artist.spotifyId ?? null,
                artistName: artist.name,
              })}
              target="_blank"
              rel="noopener noreferrer"
              className="btn"
              onClick={(e) => e.stopPropagation()}
              style={{
                flex: 1,
                height: 44,
                borderRadius: 10,
                background: PLATFORM_META[musicPlatform].brandColor,
                color: PLATFORM_META[musicPlatform].brandFg,
                borderColor: "transparent",
                fontSize: 15,
                fontWeight: 600,
              }}
            >
              <PlatformIcon platform={musicPlatform} size={16} />
              Open in {PLATFORM_META[musicPlatform].label}
            </a>
            <button
              className="btn"
              onClick={handleShare}
              title="Copy artist link"
              aria-label={`Copy link to ${artist.name}`}
              style={{ ...quietBtnStyle, flex: "none", width: 44, padding: 0 }}
            >
              <Share2 size={15} />
            </button>
          </div>

          {/* Bookmark */}
          <button
            className="btn btn-block"
            onClick={handleSave}
            aria-pressed={isSaved}
            style={{
              ...quietBtnStyle,
              flex: "none",
              color: isSaved ? "var(--violet-ink)" : "var(--fg)",
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

          {/* Feedback strip: the desktop feed's triage control */}
          <div className="fs-card-triage">
            <button onClick={() => onFeedback("thumbs_down")} className="btn" style={quietBtnStyle}>
              <ThumbsDown size={16} strokeWidth={1.75} aria-hidden /> Less like this
            </button>
            <button onClick={() => onFeedback("skip")} className="btn" style={{ ...quietBtnStyle, flex: 0.8 }}>
              <X size={16} strokeWidth={1.75} aria-hidden /> Dismiss
            </button>
            <button
              onClick={() => onFeedback("thumbs_up")}
              aria-pressed={isLiked}
              className="btn"
              style={{
                ...quietBtnStyle,
                flex: 1.2,
                background: isLiked ? "var(--violet-fill)" : "var(--raise)",
                color: isLiked ? "#fff" : "var(--violet-ink)",
              }}
            >
              <Heart size={16} strokeWidth={1.75} fill={isLiked ? "currentColor" : "none"} aria-hidden />
              {isLiked ? "Liked" : "More like this"}
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
