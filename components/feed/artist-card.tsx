"use client"

import "./artist-card.css"
import { memo, useCallback, type CSSProperties } from "react"
import Image from "next/image"
import { motion } from "framer-motion"
import { Bookmark, Heart, Share2, ThumbsDown, X } from "lucide-react"
import { toast } from "sonner"
import { TrackStrip } from "@/components/feed/track-strip"
import { PlatformIcon } from "@/components/platform-icon"
import { useAudio } from "@/lib/audio-context"
import { readableTextOn } from "@/lib/color-utils"
import { artworkFor, letterFor } from "@/lib/feed/artwork"
import { listSeparator, popularityLabel, whyParts } from "@/lib/feed/card-copy"
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
   *   - "thumbs_up"    → expanded card, violet outline + "Liked" button (keep playing)
   *   - "thumbs_down"  → collapsed 56px bar, "Passed"
   *   - "skip"         → collapsed 56px bar, "Dismissed"
   */
  dismissSignal?: string | null
  /** When true, hero image is preloaded (set on the LCP card only). */
  priority?: boolean
}

// ---------------------------------------------------------------------------
// Component (styles: artist-card.css, every rule scoped under .ex-card)
// ---------------------------------------------------------------------------

// Collapse the card for thumbs_down / skip, but NOT thumbs_up — we keep the
// card visible after a like so the user can keep listening. Bookmark no
// longer dismisses: saves only toggle the bookmark icon.
function signalCollapses(signal: string | null | undefined): boolean {
  return signal != null && signal !== "thumbs_up"
}

const spring = { type: "spring", stiffness: 400, damping: 40 } as const

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
  const artistColor = useArtistColor(artist.artistColor, artist.name)
  // The only inline style: the artist's colour, which the stylesheet derives its shades from.
  const tint = { "--a": artistColor } as CSSProperties

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

  // ------------------------------------------------------------------
  // Collapsed (slim bar) state. Only applies to thumbs_down / skip.
  // Thumbs_up and saves keep the card expanded.
  // ------------------------------------------------------------------
  if (isCollapsed) {
    const passed = dismissSignal === "thumbs_down"

    return (
      <motion.div layout exit={{ opacity: 0 }} transition={spring} className="ex-card ex-card-bar" style={tint}>
        <span className="ex-card-bar-name">{artist.name}</span>
        <span className="ex-card-bar-state">
          {passed ? <ThumbsDown size={14} aria-hidden /> : <X size={14} aria-hidden />}
          {passed ? "Passed" : "Dismissed"}
        </span>
      </motion.div>
    )
  }

  const art = artworkFor(artist)
  const why = whyParts(artist.why)
  const platform = PLATFORM_META[musicPlatform]
  const genres = (artist.genres ?? []).slice(0, 2).join(" · ")

  // ------------------------------------------------------------------
  // Expanded card (also after thumbs_up — the card stays so the user can keep
  // playing tracks; liked = violet outline + the More button turning "Liked").
  // ------------------------------------------------------------------
  return (
    <motion.div
      layout
      initial={{ y: 20 }}
      animate={{ y: 0 }}
      transition={spring}
      className="ex-card"
      data-liked={isLiked || undefined}
      style={tint}
    >
      <div className="ex-card-art">
        {art ? (
          <Image
            src={art}
            alt={artist.name}
            fill
            sizes="(min-width: 1100px) 400px, (min-width: 900px) 440px, 100vw"
            priority={priority}
            className="ex-card-img"
          />
        ) : (
          <span className="ex-card-letter" style={{ color: readableTextOn(artistColor) }} aria-hidden>
            {letterFor(artist.name)}
          </span>
        )}
      </div>

      <div className="ex-card-body">
        <div>
          <h3 className="ex-card-name">{artist.name}</h3>
          {genres && <p className="ex-card-genres">{genres}</p>}
          <p className="ex-card-pop">
            <span className="ex-meter" aria-hidden>
              <span style={{ "--p": Math.min(100, Math.max(0, artist.popularity)) / 100 } as CSSProperties} />
            </span>
            {popularityLabel(artist.popularity)} · popularity {artist.popularity}
          </p>
          {why && (
            <p className="ex-card-why">
              {why.lead}
              {why.names.length > 0
                ? why.names.map((n, i) => (
                    <span key={n}>
                      {listSeparator(i, why.names.length)}
                      <strong>{n}</strong>
                    </span>
                  ))
                : why.genres.join(", ")}
            </p>
          )}
        </div>

        {localTracks.length > 0 ? (
          <div onClick={(e) => e.stopPropagation()}>
            <TrackStrip tracks={localTracks} artistColor={artistColor} onPlay={handlePlay} />
          </div>
        ) : (
          <p className="ex-card-note">{isFetchingTracks ? "Loading tracks…" : "No tracks available"}</p>
        )}

        <div className="ex-card-actions">
          <div className="ex-triage">
            <button type="button" onClick={() => onFeedback("thumbs_down")} className="ex-tri">
              <ThumbsDown size={16} strokeWidth={1.75} aria-hidden /> Less like this
            </button>
            <button type="button" onClick={() => onFeedback("skip")} className="ex-tri">
              <X size={16} strokeWidth={1.75} aria-hidden /> Dismiss
            </button>
            <button type="button" onClick={() => onFeedback("thumbs_up")} aria-pressed={isLiked} className="ex-tri ex-tri-like">
              <Heart size={16} strokeWidth={1.75} fill={isLiked ? "currentColor" : "none"} aria-hidden />
              {isLiked ? "Liked" : "More like this"}
            </button>
          </div>

          <div className="ex-secondary">
            <button type="button" className="ex-sec" onClick={handleSave} aria-pressed={isSaved}>
              <Bookmark size={16} strokeWidth={1.75} fill={isSaved ? "currentColor" : "none"} aria-hidden />
              <span className="ex-sec-label">{isSaved ? "Bookmarked" : "Bookmark"}</span>
            </button>
            <a
              href={getArtistLink(musicPlatform, {
                artistId: artist.id,
                spotifyId: artist.spotifyId ?? null,
                artistName: artist.name,
              })}
              target="_blank"
              rel="noopener noreferrer"
              className="ex-sec"
              aria-label={`Open in ${platform.label}`}
              onClick={(e) => e.stopPropagation()}
            >
              <PlatformIcon platform={musicPlatform} size={16} />
              <span className="ex-sec-label">{platform.label}</span>
            </a>
            <button
              type="button"
              className="ex-sec"
              onClick={handleShare}
              title="Copy artist link"
              aria-label={`Share: copy link to ${artist.name}`}
            >
              <Share2 size={16} strokeWidth={1.75} aria-hidden /> <span className="ex-sec-label">Share</span>
            </button>
          </div>
        </div>
      </div>
    </motion.div>
  )
}

// Memoized so that toggling a save on one card doesn't re-render every
// sibling in the rail. Props are all primitives plus two callbacks that
// ExploreArtistRow stabilizes per artist id.
export const ArtistCard = memo(ArtistCardImpl)
