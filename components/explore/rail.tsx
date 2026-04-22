"use client"

import { useState } from "react"
import Link from "next/link"
import { toast } from "sonner"
import { RefreshCw, ThumbsUp, ThumbsDown, Bookmark, Check, ExternalLink } from "lucide-react"
import { stringToVibrantHex, sanitizeHex } from "@/lib/color-utils"
import { getArtistLink, type MusicPlatform } from "@/lib/music-links"

export interface RailArtist {
  id: string
  name: string
  genres: string[]
  imageUrl: string | null
  popularity: number
  artistColor?: string | null
  /** Optional rail-specific provenance (e.g. wildcards sourceArtist, six-degrees chain). */
  why?: {
    sourceArtist?: string
    chain?: Array<{ name: string; match: number }> | null
    tag?: string
    anchor?: string
  }
}

export interface RailProps {
  title: string
  subtitle?: string
  artists: RailArtist[]
  musicPlatform: MusicPlatform
  /** Called on Regenerate button press. Should re-fetch and update `artists`. */
  onRegenerate: () => Promise<void> | void
  /** Thumbs-up / thumbs-down / save handlers. */
  onFeedback: (artistId: string, signal: "thumbs_up" | "thumbs_down") => void
  onSave: (artistId: string) => void
  savedIds: Set<string>
  dismissedIds: Set<string>
  /** Optional empty-state caption. */
  emptyCaption?: string
}

export function Rail({
  title,
  subtitle,
  artists,
  musicPlatform,
  onRegenerate,
  onFeedback,
  onSave,
  savedIds,
  dismissedIds,
  emptyCaption,
}: RailProps) {
  const [regenerating, setRegenerating] = useState(false)
  const visible = artists.filter((a) => !dismissedIds.has(a.id))

  async function handleRegenerate() {
    if (regenerating) return
    setRegenerating(true)
    try {
      await onRegenerate()
    } catch {
      toast.error("Couldn't regenerate this rail")
    } finally {
      setRegenerating(false)
    }
  }

  return (
    <section style={{ marginBottom: 32 }}>
      <div
        style={{
          display: "flex",
          alignItems: "flex-end",
          justifyContent: "space-between",
          gap: 12,
          marginBottom: 10,
          padding: "0 2px",
        }}
      >
        <div>
          <h2 style={{ fontSize: 18, fontWeight: 600, margin: 0 }}>{title}</h2>
          {subtitle && (
            <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>
              {subtitle}
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={handleRegenerate}
          disabled={regenerating}
          aria-label={`Regenerate ${title}`}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 4,
            padding: "6px 10px",
            fontSize: 12,
            background: "var(--bg-card)",
            border: "1px solid var(--border)",
            borderRadius: 6,
            cursor: regenerating ? "default" : "pointer",
            color: "var(--text-faint)",
            opacity: regenerating ? 0.6 : 1,
          }}
        >
          <RefreshCw size={12} className={regenerating ? "spin" : undefined} />
          <span>{regenerating ? "…" : "Regenerate"}</span>
        </button>
      </div>

      {visible.length === 0 ? (
        <div
          className="muted"
          style={{
            padding: "24px 16px",
            fontSize: 13,
            textAlign: "center",
            border: "1px dashed var(--border)",
            borderRadius: 8,
          }}
        >
          {emptyCaption ?? "Nothing here yet — try regenerating."}
        </div>
      ) : (
        <div
          style={{
            display: "flex",
            overflowX: "auto",
            scrollSnapType: "x mandatory",
            gap: 12,
            paddingBottom: 8,
            WebkitOverflowScrolling: "touch",
          }}
        >
          {visible.map((artist) => (
            <ExploreCard
              key={artist.id}
              artist={artist}
              musicPlatform={musicPlatform}
              isSaved={savedIds.has(artist.id)}
              onFeedback={(sig) => onFeedback(artist.id, sig)}
              onSave={() => onSave(artist.id)}
            />
          ))}
        </div>
      )}
    </section>
  )
}

interface ExploreCardProps {
  artist: RailArtist
  musicPlatform: MusicPlatform
  isSaved: boolean
  onFeedback: (signal: "thumbs_up" | "thumbs_down") => void
  onSave: () => void
}

function ExploreCard({ artist, musicPlatform, isSaved, onFeedback, onSave }: ExploreCardProps) {
  const color = (() => {
    const c = sanitizeHex(artist.artistColor)
    if (c === "#8b5cf6") return stringToVibrantHex(artist.name)
    return c
  })()

  const link = getArtistLink(musicPlatform, { spotifyArtistId: artist.id, artistName: artist.name })

  return (
    <article
      style={{
        flex: "0 0 220px",
        scrollSnapAlign: "start",
        display: "flex",
        flexDirection: "column",
        background: "var(--bg-card)",
        border: "1px solid var(--border)",
        borderRadius: 12,
        overflow: "hidden",
      }}
    >
      <div
        style={{
          position: "relative",
          aspectRatio: "1 / 1",
          background: color,
          backgroundImage: artist.imageUrl ? `url(${artist.imageUrl})` : undefined,
          backgroundSize: "cover",
          backgroundPosition: "center",
        }}
      >
        {link && (
          <Link
            href={link}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`Open ${artist.name} in ${musicPlatform}`}
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              alignItems: "flex-end",
              justifyContent: "flex-end",
              padding: 8,
              color: "rgba(255,255,255,0.9)",
              textShadow: "0 1px 2px rgba(0,0,0,0.6)",
            }}
          >
            <ExternalLink size={16} />
          </Link>
        )}
      </div>

      <div style={{ padding: 10, display: "flex", flexDirection: "column", gap: 6 }}>
        <div style={{ fontSize: 14, fontWeight: 600, lineHeight: 1.2 }}>{artist.name}</div>
        {artist.genres.length > 0 && (
          <div className="muted" style={{ fontSize: 11, lineHeight: 1.3 }}>
            {artist.genres.slice(0, 2).join(" · ")}
          </div>
        )}
        {artist.why?.sourceArtist && (
          <div className="muted" style={{ fontSize: 10, fontStyle: "italic" }}>
            via {artist.why.sourceArtist}
          </div>
        )}
        {artist.why?.chain && artist.why.chain.length > 0 && (
          <div className="muted" style={{ fontSize: 10, lineHeight: 1.4 }}>
            {artist.why.chain.map((hop) => hop.name).join(" → ")}
          </div>
        )}

        <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
          <button
            type="button"
            onClick={() => onFeedback("thumbs_up")}
            aria-label="Thumbs up"
            className="icon-btn"
            style={iconBtnStyle}
          >
            <ThumbsUp size={14} />
          </button>
          <button
            type="button"
            onClick={() => onFeedback("thumbs_down")}
            aria-label="Thumbs down"
            className="icon-btn"
            style={iconBtnStyle}
          >
            <ThumbsDown size={14} />
          </button>
          <button
            type="button"
            onClick={onSave}
            aria-label={isSaved ? "Unsave" : "Save"}
            className="icon-btn"
            style={{ ...iconBtnStyle, marginLeft: "auto" }}
          >
            {isSaved ? <Check size={14} /> : <Bookmark size={14} />}
          </button>
        </div>
      </div>
    </article>
  )
}

const iconBtnStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  width: 30,
  height: 30,
  borderRadius: 6,
  background: "transparent",
  border: "1px solid var(--border)",
  color: "var(--text-faint)",
  cursor: "pointer",
}
