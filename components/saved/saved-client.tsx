"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { X, Bookmark, Share2 } from "lucide-react"
import { toast } from "sonner"
import { stringToVibrantHex, sanitizeHex } from "@/lib/color-utils"
import {
  PLATFORM_META,
  getArtistLink,
  getShareableArtistLink,
  type MusicPlatform,
} from "@/lib/music-links"
import { PlatformIcon } from "@/components/platform-icon"

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

export function SavedClient({ artists, hasLastfm, musicPlatform }: SavedClientProps) {
  const router = useRouter()
  const [removedIds, setRemovedIds] = useState<Set<string>>(new Set())

  const visible = artists.filter((a) => !removedIds.has(a.artistId))

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
      {/* Page header */}
      <div className="page-head">
        <h1>Saved</h1>
        <span className="sub">{visible.length} artists</span>
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
          {!hasLastfm && (
            <div style={{ fontSize: 12, marginTop: 8, lineHeight: 1.5 }}>
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
            const color = sanitizeHex(artist.artistColor) !== "#8b5cf6"
              ? sanitizeHex(artist.artistColor)
              : stringToVibrantHex(artist.name)
            return (
              <div
                key={artist.artistId}
                style={{
                  background: "var(--bg-card)",
                  border: "1px solid var(--border)",
                  borderRadius: 18,
                  overflow: "hidden",
                  display: "flex",
                  flexDirection: "column",
                }}
              >
                {/* Image */}
                <div style={{ height: 120, position: "relative" }}>
                  {artist.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={artist.imageUrl}
                      alt={artist.name}
                      style={{ width: "100%", height: "100%", objectFit: "cover" }}
                    />
                  ) : (
                    <div
                      style={{
                        width: "100%",
                        height: "100%",
                        background: `linear-gradient(135deg, ${color}66, ${color}26)`,
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

                {/* Meta */}
                <div style={{ padding: "12px 14px" }}>
                  <div style={{ fontWeight: 700, fontSize: 14, lineHeight: 1.2 }}>{artist.name}</div>
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
                  <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
                    <a
                      href={getArtistLink(musicPlatform, {
                        spotifyArtistId: artist.artistId,
                        artistName: artist.name,
                      })}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{
                        width: 28, height: 28, borderRadius: 8,
                        background: "rgba(255,255,255,0.05)", border: "1px solid var(--border)",
                        display: "grid", placeItems: "center", color: "var(--text-muted)",
                      }}
                      title={`Open in ${PLATFORM_META[musicPlatform].label}`}
                    >
                      <PlatformIcon platform={musicPlatform} size={12} color={PLATFORM_META[musicPlatform].brandColor} />
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
                        width: 28, height: 28, borderRadius: 8,
                        background: "rgba(255,255,255,0.05)", border: "1px solid var(--border)",
                        display: "grid", placeItems: "center", color: "var(--text-muted)", cursor: "pointer",
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
