"use client"

import { useState } from "react"
import Image from "next/image"
import { useRouter } from "next/navigation"
import { X, Bookmark, Share2 } from "lucide-react"
import { toast } from "sonner"
import { stringToVibrantHex, sanitizeHex, hexToRgba } from "@/lib/color-utils"
import {
  PLATFORM_META,
  getArtistLink,
  getShareableArtistLink,
  type MusicPlatform,
} from "@/lib/music-links"
import { PlatformIcon } from "@/components/platform-icon"
import { Ambient } from "@/components/visual/ambient"

export interface SavedArtistRow {
  artistId: string
  name: string
  genres: string[]
  imageUrl: string | null
  artistColor: string
}

interface SavedClientProps {
  artists: SavedArtistRow[]
  hasLastfm: boolean
  musicPlatform: MusicPlatform
}

// DB stores #8b5cf6 as the default artist_color when album art hasn't been
// processed yet. Treat that sentinel as "no real color" and fall back to the
// deterministic name-hash so every artist gets a distinctive tint.
const DEFAULT_SENTINEL = "#8b5cf6"
function resolveColor(artist: SavedArtistRow): string {
  const sanitized = sanitizeHex(artist.artistColor)
  if (sanitized && sanitized.toLowerCase() !== DEFAULT_SENTINEL) return sanitized
  return stringToVibrantHex(artist.name)
}

export function SavedClient({ artists, hasLastfm, musicPlatform }: SavedClientProps) {
  const router = useRouter()
  const [removedIds, setRemovedIds] = useState<Set<string>>(new Set())

  const visible = artists.filter((a) => !removedIds.has(a.artistId))

  const accent = "#8b5cf6"
  const c1 = visible[0] ? resolveColor(visible[0]) : accent
  const c2 = visible[1] ? resolveColor(visible[1]) : "#ec6fb5"
  const palette = `
    radial-gradient(50% 40% at 18% 20%, ${hexToRgba(c1, 0.22)} 0%, transparent 70%),
    radial-gradient(55% 45% at 82% 30%, ${hexToRgba(c2, 0.18)} 0%, transparent 70%),
    radial-gradient(70% 55% at 50% 90%, ${hexToRgba(accent, 0.14)} 0%, transparent 70%)
  `

  async function handleUnsave(artistId: string) {
    setRemovedIds((prev) => new Set(prev).add(artistId))
    try {
      const res = await fetch("/api/saves", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ spotifyArtistId: artistId }),
      })
      if (!res.ok) throw new Error("Server error")
      router.refresh()
    } catch {
      setRemovedIds((prev) => {
        const next = new Set(prev)
        next.delete(artistId)
        return next
      })
      toast.error("Couldn't unsave — try again")
    }
  }

  return (
    <div>
      <Ambient palette={palette} />

      <div className="page-head">
        <h1>Saved</h1>
        <span className="sub">
          <span className="serif" style={{ fontSize: 15, color: "var(--text-secondary)" }}>
            A quiet list of sounds you want to remember.
          </span>
          <span style={{ display: "block", marginTop: 4 }}>{visible.length} artists</span>
        </span>
      </div>

      {visible.length === 0 ? (
        <div
          style={{
            textAlign: "center",
            padding: "80px 20px",
            color: "var(--text-muted)",
          }}
        >
          <Bookmark size={32} style={{ margin: "0 auto 12px", display: "block", opacity: 0.4 }} />
          <div style={{ fontSize: 14 }}>
            Bookmark artists from your feed to keep them here.
          </div>
          <div style={{ marginTop: 16 }}>
            <a
              href="/feed"
              className="btn"
              style={{ display: "inline-block", textDecoration: "none" }}
            >
              Go to your feed
            </a>
          </div>
          {!hasLastfm && (
            <div style={{ fontSize: 12, marginTop: 14, lineHeight: 1.5 }}>
              Connect Last.fm in{" "}
              <a href="/settings" style={{ color: "var(--accent)" }}>
                Settings
              </a>{" "}
              to seed the engine with your listening history.
            </div>
          )}
        </div>
      ) : (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))",
            gap: 12,
            marginTop: 8,
          }}
        >
          {visible.map((artist) => {
            const color = resolveColor(artist)
            return (
              <div
                key={artist.artistId}
                style={{
                  position: "relative",
                  background: `linear-gradient(180deg, ${hexToRgba(color, 0.12)} 0%, var(--bg-card) 70%)`,
                  border: `1px solid ${hexToRgba(color, 0.22)}`,
                  borderRadius: 18,
                  overflow: "hidden",
                  display: "flex",
                  flexDirection: "column",
                  boxShadow: `0 8px 24px ${hexToRgba(color, 0.10)}`,
                }}
              >
                <div style={{ height: 120, position: "relative" }}>
                  {artist.imageUrl ? (
                    <Image
                      src={artist.imageUrl}
                      alt={artist.name}
                      fill
                      sizes="(max-width: 640px) 50vw, 220px"
                      style={{ objectFit: "cover" }}
                      unoptimized
                    />
                  ) : (
                    <div
                      style={{
                        width: "100%",
                        height: "100%",
                        background: `linear-gradient(135deg, ${hexToRgba(color, 0.4)}, ${hexToRgba(color, 0.15)})`,
                      }}
                    />
                  )}
                  <button
                    onClick={() => handleUnsave(artist.artistId)}
                    aria-label={`Remove ${artist.name}`}
                    style={{
                      position: "absolute",
                      top: 8,
                      right: 8,
                      width: 30,
                      height: 30,
                      borderRadius: "50%",
                      background: "rgba(0,0,0,0.6)",
                      backdropFilter: "blur(8px)",
                      WebkitBackdropFilter: "blur(8px)",
                      border: 0,
                      color: "#fff",
                      display: "grid",
                      placeItems: "center",
                      cursor: "pointer",
                    }}
                  >
                    <X size={14} />
                  </button>
                </div>

                <div style={{ padding: "12px 14px", display: "flex", flexDirection: "column", gap: 8, flex: 1 }}>
                  <div style={{ minWidth: 0 }}>
                    <div
                      style={{
                        fontWeight: 700,
                        fontSize: 14,
                        lineHeight: 1.2,
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                    >
                      {artist.name}
                    </div>
                    {artist.genres.length > 0 && (
                      <div
                        className="mono"
                        style={{
                          fontSize: 10.5,
                          color,
                          marginTop: 4,
                          textTransform: "uppercase",
                          letterSpacing: "0.1em",
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                        }}
                      >
                        {artist.genres[0]}
                      </div>
                    )}
                  </div>
                  <div style={{ display: "flex", gap: 6, marginTop: "auto" }}>
                    <a
                      href={getArtistLink(musicPlatform, {
                        spotifyArtistId: artist.artistId,
                        artistName: artist.name,
                      })}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{
                        width: 28,
                        height: 28,
                        borderRadius: 8,
                        background: hexToRgba(color, 0.12),
                        border: `1px solid ${hexToRgba(color, 0.25)}`,
                        display: "grid",
                        placeItems: "center",
                        color,
                      }}
                      title={`Open in ${PLATFORM_META[musicPlatform].label}`}
                    >
                      <PlatformIcon platform={musicPlatform} size={12} color={color} />
                    </a>
                    <button
                      onClick={() => {
                        const url = getShareableArtistLink(musicPlatform, {
                          spotifyArtistId: artist.artistId,
                          artistName: artist.name,
                        })
                        navigator.clipboard.writeText(url)
                          .then(() => toast.success("Link copied!"))
                          .catch(() => toast.error("Couldn't copy link"))
                      }}
                      style={{
                        width: 28,
                        height: 28,
                        borderRadius: 8,
                        background: hexToRgba(color, 0.08),
                        border: `1px solid ${hexToRgba(color, 0.18)}`,
                        display: "grid",
                        placeItems: "center",
                        color,
                        cursor: "pointer",
                      }}
                      title="Copy link"
                    >
                      <Share2 size={12} />
                    </button>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
