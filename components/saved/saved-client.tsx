"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { X, Bookmark } from "lucide-react"
import type { Track } from "@/lib/music-provider/types"

export interface SavedArtistRow {
  artistId: string
  name: string
  genres: string[]
  imageUrl: string | null
  artistColor: string
  topTracks: Track[]
}

export interface SavedTrackRow {
  id: string
  name: string
  artistName: string
  albumImageUrl: string | null
  durationMs: number
}

interface SavedClientProps {
  artists: SavedArtistRow[]
  tracks: SavedTrackRow[]
  hasLastfm: boolean
}

function stringToVibrantHex(str: string): string {
  let hash = 0
  for (let i = 0; i < str.length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash)
  const hue = Math.abs(hash) % 360
  const s = 0.70, l = 0.65
  const c = (1 - Math.abs(2 * l - 1)) * s
  const x = c * (1 - Math.abs((hue / 60) % 2 - 1))
  const m = l - c / 2
  let r = 0, g = 0, b = 0
  if (hue < 60)       { r = c; g = x; b = 0 }
  else if (hue < 120) { r = x; g = c; b = 0 }
  else if (hue < 180) { r = 0; g = c; b = x }
  else if (hue < 240) { r = 0; g = x; b = c }
  else if (hue < 300) { r = x; g = 0; b = c }
  else                { r = c; g = 0; b = x }
  const toHex = (n: number) => {
    const hex = Math.round((n + m) * 255).toString(16)
    return hex.length === 1 ? "0" + hex : hex
  }
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`
}

export function SavedClient({ artists, tracks: _tracks, hasLastfm }: SavedClientProps) {
  const router = useRouter()
  const [removedIds, setRemovedIds] = useState<Set<string>>(new Set())

  const visible = artists.filter((a) => !removedIds.has(a.artistId))

  async function handleUnsave(artistId: string) {
    setRemovedIds((prev) => new Set(prev).add(artistId))
    try {
      await fetch("/api/saves", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ spotifyArtistId: artistId }),
      })
    } catch {
      setRemovedIds((prev) => {
        const next = new Set(prev)
        next.delete(artistId)
        return next
      })
    }
    router.refresh()
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
            const color = artist.artistColor !== "#8b5cf6"
              ? artist.artistColor
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
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
