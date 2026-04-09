"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Heart } from "lucide-react"
import { TrackStrip } from "@/components/feed/track-strip"
import type { Track } from "@/lib/music-provider/types"

// ---------------------------------------------------------------------------
// Types passed from the server page
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}:${seconds.toString().padStart(2, "0")}`
}

// ---------------------------------------------------------------------------
// Tab switcher
// ---------------------------------------------------------------------------

type Tab = "artists" | "tracks"

function TabSwitcher({ active, onChange }: { active: Tab; onChange: (t: Tab) => void }) {
  return (
    <div
      style={{
        display: "flex",
        gap: 4,
        padding: "4px",
        background: "var(--bg-elevated)",
        borderRadius: 10,
        marginBottom: 16,
      }}
    >
      {(["artists", "tracks"] as Tab[]).map((tab) => {
        const isActive = tab === active
        return (
          <button
            key={tab}
            onClick={() => onChange(tab)}
            style={{
              flex: 1,
              padding: "7px 0",
              borderRadius: 7,
              border: "none",
              background: isActive ? "var(--accent)" : "transparent",
              color: isActive ? "#fff" : "var(--text-secondary)",
              fontFamily: "Inter, sans-serif",
              fontSize: 13,
              fontWeight: isActive ? 600 : 400,
              cursor: "pointer",
              transition: "background 0.15s, color 0.15s",
              textTransform: "capitalize",
            }}
          >
            {tab}
          </button>
        )
      })}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Artists tab
// ---------------------------------------------------------------------------

function ArtistsTab({
  artists,
  hasLastfm,
}: {
  artists: SavedArtistRow[]
  hasLastfm: boolean
}) {
  const router = useRouter()
  const [removedIds, setRemovedIds] = useState<Set<string>>(new Set())

  async function handleUnsave(artistId: string) {
    // Optimistic remove
    setRemovedIds((prev) => new Set(prev).add(artistId))
    try {
      await fetch("/api/saves", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ spotifyArtistId: artistId }),
      })
    } catch {
      // On failure, re-show row
      setRemovedIds((prev) => {
        const next = new Set(prev)
        next.delete(artistId)
        return next
      })
    }
    router.refresh()
  }

  const visible = artists.filter((a) => !removedIds.has(a.artistId))

  if (visible.length === 0) {
    return (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          padding: "60px 24px",
          textAlign: "center",
          gap: 10,
        }}
      >
        <p
          style={{
            fontFamily: "Inter, sans-serif",
            fontSize: 14,
            fontWeight: 400,
            color: "var(--text-secondary)",
            margin: 0,
          }}
        >
          No saved artists yet
        </p>
        {!hasLastfm && (
          <p
            style={{
              fontFamily: "Inter, sans-serif",
              fontSize: 12,
              fontWeight: 400,
              color: "var(--text-muted)",
              margin: 0,
            }}
          >
            Connect Last.fm to discover more artists based on your full listening history.{" "}
            <a
              href="/settings"
              style={{
                color: "var(--accent)",
                textDecoration: "underline",
              }}
            >
              Go to Settings
            </a>
          </p>
        )}
      </div>
    )
  }

  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      {visible.map((artist) => (
        <div
          key={artist.artistId}
          style={{
            display: "flex",
            flexDirection: "row",
            alignItems: "center",
            gap: 12,
            padding: "12px 16px",
            borderBottom: "1px solid var(--border)",
          }}
        >
          {/* Artist photo */}
          {artist.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={artist.imageUrl}
              alt={artist.name}
              width={46}
              height={46}
              style={{
                width: 46,
                height: 46,
                borderRadius: 8,
                objectFit: "cover",
                flexShrink: 0,
                backgroundColor: "#1a1a1a",
              }}
            />
          ) : (
            <div
              style={{
                width: 46,
                height: 46,
                borderRadius: 8,
                backgroundColor: "#1a1a1a",
                flexShrink: 0,
              }}
            />
          )}

          {/* Centre column */}
          <div style={{ display: "flex", flexDirection: "column", flex: 1, minWidth: 0 }}>
            <span
              style={{
                fontFamily: "var(--font-display, 'Space Grotesk', sans-serif)",
                fontSize: 16,
                fontWeight: 700,
                color: "var(--text-primary)",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {artist.name}
            </span>

            {artist.genres.length > 0 && (
              <span
                style={{
                  fontFamily: "Inter, sans-serif",
                  fontSize: 9,
                  fontWeight: 500,
                  textTransform: "uppercase",
                  letterSpacing: "0.08em",
                  color: "var(--text-muted)",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  marginTop: 1,
                }}
              >
                {artist.genres.slice(0, 3).join(" · ")}
              </span>
            )}

            {artist.topTracks.length > 0 && (
              <TrackStrip
                tracks={artist.topTracks}
                compact={true}
                artistColor={artist.artistColor}
              />
            )}
          </div>

          {/* Unsave button */}
          <button
            onClick={() => handleUnsave(artist.artistId)}
            aria-label={`Unsave ${artist.name}`}
            style={{
              background: "none",
              border: "none",
              padding: 6,
              cursor: "pointer",
              color: "var(--accent)",
              flexShrink: 0,
              display: "flex",
              alignItems: "center",
            }}
          >
            <Heart size={18} fill="currentColor" strokeWidth={0} />
          </button>
        </div>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Tracks tab
// ---------------------------------------------------------------------------

function TracksTab({ tracks }: { tracks: SavedTrackRow[] }) {
  if (tracks.length === 0) {
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "60px 24px",
          textAlign: "center",
        }}
      >
        <p
          style={{
            fontFamily: "Inter, sans-serif",
            fontSize: 14,
            fontWeight: 400,
            color: "var(--text-secondary)",
            margin: 0,
          }}
        >
          No saved tracks yet
        </p>
      </div>
    )
  }

  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      {tracks.map((track) => (
        <div
          key={track.id}
          style={{
            display: "flex",
            flexDirection: "row",
            alignItems: "center",
            gap: 10,
            padding: "10px 16px",
            borderBottom: "1px solid var(--border)",
          }}
        >
          {/* Album art */}
          {track.albumImageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={track.albumImageUrl}
              alt={track.name}
              width={36}
              height={36}
              style={{
                width: 36,
                height: 36,
                borderRadius: 6,
                objectFit: "cover",
                flexShrink: 0,
                backgroundColor: "#1a1a1a",
              }}
            />
          ) : (
            <div
              style={{
                width: 36,
                height: 36,
                borderRadius: 6,
                backgroundColor: "#1a1a1a",
                flexShrink: 0,
              }}
            />
          )}

          {/* Centre text */}
          <div style={{ display: "flex", flexDirection: "column", flex: 1, minWidth: 0 }}>
            <span
              style={{
                fontFamily: "Inter, sans-serif",
                fontSize: 13,
                fontWeight: 500,
                color: "var(--text-primary)",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {track.name}
            </span>
            <span
              style={{
                fontFamily: "Inter, sans-serif",
                fontSize: 11,
                fontWeight: 400,
                color: "var(--text-secondary)",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {track.artistName}
            </span>
          </div>

          {/* Duration */}
          <span
            style={{
              fontFamily: "Inter, sans-serif",
              fontSize: 10,
              fontWeight: 400,
              color: "var(--text-muted)",
              flexShrink: 0,
            }}
          >
            {formatDuration(track.durationMs)}
          </span>
        </div>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Root export
// ---------------------------------------------------------------------------

export function SavedClient({ artists, tracks, hasLastfm }: SavedClientProps) {
  const [activeTab, setActiveTab] = useState<Tab>("artists")

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "var(--bg-base)",
        paddingTop: 16,
      }}
    >
      <div style={{ maxWidth: 600, margin: "0 auto", padding: "0 0" }}>
        <div style={{ padding: "0 16px" }}>
          <TabSwitcher active={activeTab} onChange={setActiveTab} />
        </div>

        {activeTab === "artists" ? (
          <ArtistsTab artists={artists} hasLastfm={hasLastfm} />
        ) : (
          <TracksTab tracks={tracks} />
        )}
      </div>
    </div>
  )
}
