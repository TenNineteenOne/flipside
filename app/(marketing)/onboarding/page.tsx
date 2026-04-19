"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Music, ChevronDown, ChevronUp, Lock } from "lucide-react"
import type { GenreNode } from "@/lib/types"
import { GenrePicker } from "@/components/onboarding/genre-picker"
import { ArtistSearch, type SpotifyArtist } from "@/components/onboarding/artist-search"

const SPOTIFY_VISIBLE = false
const ARTIST_CAP = 200
const GENRE_CAP = 200

// ── Main component ────────────────────────────────────────────────────────────

export default function OnboardingPage() {
  const router = useRouter()
  const [saving, setSaving] = useState(false)

  // Active paths (can expand multiple)
  const [openPaths, setOpenPaths] = useState<Set<string>>(new Set())

  const [selectedArtists, setSelectedArtists] = useState<SpotifyArtist[]>([])
  const [selectedGenres, setSelectedGenres] = useState<GenreNode[]>([])
  const [lastfmUsername, setLastfmUsername] = useState("")
  const [statsfmUsername, setStatsfmUsername] = useState("")

  const togglePath = (key: string) => {
    setOpenPaths((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const selectedGenreIds = new Set(selectedGenres.map((g) => g.id))

  function addArtist(artist: SpotifyArtist) {
    setSelectedArtists((prev) => {
      if (prev.some((a) => a.id === artist.id) || prev.length >= ARTIST_CAP) return prev
      return [...prev, artist]
    })
  }

  function removeArtist(id: string) {
    setSelectedArtists((prev) => prev.filter((a) => a.id !== id))
  }

  function toggleGenre(node: GenreNode) {
    if (selectedGenreIds.has(node.id)) {
      setSelectedGenres((prev) => prev.filter((g) => g.id !== node.id))
    } else {
      setSelectedGenres((prev) => (prev.length < GENRE_CAP ? [...prev, node] : prev))
    }
  }

  const hasAnyInput =
    selectedArtists.length > 0 ||
    selectedGenres.length > 0 ||
    lastfmUsername.trim().length > 0 ||
    statsfmUsername.trim().length > 0

  async function handleContinue(skip = false) {
    if (saving) return
    setSaving(true)

    try {
      const promises: Promise<Response>[] = []

      const settingsPayload: Record<string, unknown> = {}
      if (!skip && lastfmUsername.trim()) settingsPayload.lastfmUsername = lastfmUsername.trim()
      if (!skip && statsfmUsername.trim()) settingsPayload.statsfmUsername = statsfmUsername.trim()
      if (!skip && selectedGenres.length > 0) {
        settingsPayload.selectedGenres = selectedGenres.map((g) => g.lastfmTag)
      }
      if (Object.keys(settingsPayload).length > 0) {
        promises.push(fetch("/api/settings", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(settingsPayload),
        }))
      }

      const artistsToSave = selectedArtists.slice(0, ARTIST_CAP)
      if (!skip && artistsToSave.length >= 3) {
        promises.push(fetch("/api/onboarding/seeds", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            artists: artistsToSave.map((a) => ({ id: a.id, name: a.name, imageUrl: a.imageUrl })),
          }),
        }))
      }

      const results = await Promise.all(promises)
      const failed = results.find((r) => !r.ok)
      if (failed) {
        toast.error("Some settings couldn't be saved — you can update them later")
      }
      router.push("/feed")
    } catch {
      toast.error("Something went wrong — please try again")
      setSaving(false)
    }
  }

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "center",
        padding: "40px 16px 80px",
      }}
    >
      {/* Ambient aura */}
      <div
        aria-hidden
        style={{
          position: "fixed",
          top: "25%",
          left: "50%",
          transform: "translate(-50%, -50%)",
          width: 600,
          height: 600,
          borderRadius: "50%",
          background: "radial-gradient(circle, rgba(139,92,246,0.15) 0%, transparent 70%)",
          pointerEvents: "none",
          zIndex: 0,
        }}
      />

      <div style={{ position: "relative", zIndex: 1, width: "100%", maxWidth: 480 }}>

        {/* Header */}
        <div style={{ marginBottom: 32, textAlign: "center" }}>
          <div className="topnav-brand" style={{ justifyContent: "center", marginBottom: 12 }}>
            <span className="dot" />
            flipside
          </div>
          <div className="serif" style={{ fontSize: 26, lineHeight: 1.25, marginBottom: 8 }}>
            How should we seed your feed?
          </div>
          <div className="muted" style={{ fontSize: 13 }}>
            Pick one or more paths — or skip and start cold.
          </div>
        </div>

        {/* Path cards */}
        <div className="col gap-12">

          {/* ── Artist search ───────────────────────────────────────── */}
          <PathCard
            icon={<Music size={16} />}
            title="Artists I like"
            subtitle="Search for artists to seed the engine"
            open={openPaths.has("artists")}
            onToggle={() => togglePath("artists")}
            chipCount={selectedArtists.length}
          >
            <ArtistSearch
              selected={selectedArtists}
              onAdd={addArtist}
              onRemove={removeArtist}
              cap={ARTIST_CAP}
            />
          </PathCard>

          {/* ── Genre picker ────────────────────────────────────────── */}
          <PathCard
            icon={<span style={{ fontSize: 15 }}>♫</span>}
            title="Genres I love"
            subtitle="Start broad, drill into niche"
            open={openPaths.has("genres")}
            onToggle={() => togglePath("genres")}
            chipCount={selectedGenres.length}
          >
            <GenrePicker
              selected={selectedGenres}
              onToggle={toggleGenre}
              cap={GENRE_CAP}
            />
          </PathCard>

          {/* ── Last.fm ─────────────────────────────────────────────── */}
          <PathCard
            icon={<span style={{ fontSize: 15 }}>♪</span>}
            title="Last.fm history"
            subtitle="Import your scrobble history"
            open={openPaths.has("lastfm")}
            onToggle={() => togglePath("lastfm")}
            chipCount={lastfmUsername.trim() ? 1 : 0}
          >
            <div className="col gap-8">
              <div className="field" style={{ height: 40 }}>
                <input
                  type="text"
                  placeholder="your-lastfm-username"
                  value={lastfmUsername}
                  onChange={(e) => setLastfmUsername(e.target.value)}
                  spellCheck={false}
                />
              </div>
              <div className="muted" style={{ fontSize: 11.5, lineHeight: 1.5 }}>
                We&rsquo;ll pull your top artists to filter out music you already know.
              </div>
            </div>
          </PathCard>

          {/* ── stats.fm ────────────────────────────────────────────── */}
          <PathCard
            icon={<span style={{ fontSize: 15 }}>📊</span>}
            title="stats.fm history"
            subtitle="Import your Spotify listening stats"
            open={openPaths.has("statsfm")}
            onToggle={() => togglePath("statsfm")}
            chipCount={statsfmUsername.trim() ? 1 : 0}
          >
            <div className="col gap-8">
              <div className="field" style={{ height: 40 }}>
                <input
                  type="text"
                  placeholder="your-statsfm-username"
                  value={statsfmUsername}
                  onChange={(e) => setStatsfmUsername(e.target.value)}
                  spellCheck={false}
                />
              </div>
              <div className="muted" style={{ fontSize: 11.5, lineHeight: 1.5 }}>
                Your stats.fm profile must be public. We&rsquo;ll pull top artists to filter familiars.
              </div>
            </div>
          </PathCard>

          {/* ── Spotify (locked) — hidden for now ──────────────────── */}
          {SPOTIFY_VISIBLE && (
            <div
              className="fs-card"
              style={{
                display: "flex",
                alignItems: "center",
                gap: 14,
                opacity: 0.45,
                cursor: "default",
              }}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="var(--spotify)" style={{ flexShrink: 0 }}>
                <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z"/>
              </svg>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 14, fontWeight: 600 }}>Spotify</div>
                <div className="mono" style={{ fontSize: 11, color: "var(--text-muted)" }}>restricted access</div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 6, color: "var(--text-faint)" }}>
                <Lock size={12} />
                <span style={{ fontSize: 10.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em" }}>locked</span>
              </div>
            </div>
          )}

        </div>

        {/* Actions */}
        <div className="col gap-10" style={{ marginTop: 28 }}>
          <button
            className="btn btn-primary btn-block"
            onClick={() => handleContinue(false)}
            disabled={!hasAnyInput || saving}
            style={{ height: 48, fontSize: 15 }}
          >
            {saving ? "Saving…" : "Get started →"}
          </button>
          <button
            className="btn btn-block"
            onClick={() => handleContinue(true)}
            disabled={saving}
            style={{ height: 44, fontSize: 14, color: "var(--text-muted)", borderColor: "var(--border)" }}
          >
            Skip — show me anything
          </button>
        </div>

        <div className="mono" style={{ marginTop: 20, textAlign: "center", fontSize: 10, color: "var(--text-faint)" }}>
          You can change any of this in Settings later.
        </div>
      </div>
    </div>
  )
}

// ── PathCard ──────────────────────────────────────────────────────────────────

function PathCard({
  icon,
  title,
  subtitle,
  open,
  onToggle,
  chipCount,
  children,
}: {
  icon: React.ReactNode
  title: string
  subtitle: string
  open: boolean
  onToggle: () => void
  chipCount: number
  children: React.ReactNode
}) {
  return (
    <div
      className="fs-card"
      style={{
        padding: 0,
        overflow: "hidden",
        borderColor: open ? "rgba(139,92,246,0.4)" : "var(--border)",
        background: open ? "rgba(139,92,246,0.04)" : "var(--bg-card)",
        transition: "border-color 0.15s, background 0.15s",
      }}
    >
      <button
        type="button"
        onClick={onToggle}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          width: "100%",
          padding: "14px 16px",
          background: "none",
          border: 0,
          cursor: "pointer",
          textAlign: "left",
        }}
      >
        <div
          style={{
            width: 32,
            height: 32,
            borderRadius: 8,
            background: open ? "rgba(139,92,246,0.18)" : "rgba(255,255,255,0.06)",
            display: "grid",
            placeItems: "center",
            color: open ? "var(--accent)" : "var(--text-muted)",
            flexShrink: 0,
            transition: "all 0.15s",
          }}
        >
          {icon}
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 14, fontWeight: 600, display: "flex", alignItems: "center", gap: 8 }}>
            {title}
            {chipCount > 0 && (
              <span
                className="mono"
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  padding: "1px 6px",
                  borderRadius: 4,
                  background: "rgba(139,92,246,0.2)",
                  color: "var(--accent)",
                }}
              >
                {chipCount}
              </span>
            )}
          </div>
          <div className="muted" style={{ fontSize: 11.5, marginTop: 2 }}>{subtitle}</div>
        </div>
        <div style={{ color: "var(--text-faint)", flexShrink: 0 }}>
          {open ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </div>
      </button>

      {open && (
        <div style={{ padding: "0 16px 16px", borderTop: "1px solid var(--border)" }}>
          <div style={{ paddingTop: 14 }}>{children}</div>
        </div>
      )}
    </div>
  )
}
