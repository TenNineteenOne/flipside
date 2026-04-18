"use client"

import { useState, useEffect, useRef } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Search, X, Music, ChevronDown, ChevronUp, Lock } from "lucide-react"
import genreData from "@/data/genres.json"
import type { GenreNode } from "@/lib/types"

// ── Types ────────────────────────────────────────────────────────────────────

interface SpotifyArtist {
  id: string
  name: string
  genres: string[]
  imageUrl: string | null
  popularity: number
}

// ── Genre helpers ─────────────────────────────────────────────────────────────

const ALL_GENRES: GenreNode[] = (genreData as { nodes: GenreNode[] }).nodes

// ── Sub-components ────────────────────────────────────────────────────────────

function Chip({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <div
      className="chip selected"
      style={{ display: "flex", alignItems: "center", gap: 6 }}
    >
      <span>{label}</span>
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Remove ${label}`}
        style={{ background: "none", border: 0, cursor: "pointer", color: "inherit", padding: 0, display: "flex" }}
      >
        <X size={11} />
      </button>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export default function OnboardingPage() {
  const router = useRouter()
  const [saving, setSaving] = useState(false)

  // Active paths (can expand multiple)
  const [openPaths, setOpenPaths] = useState<Set<string>>(new Set())

  // Artist search state
  const [artistQuery, setArtistQuery] = useState("")
  const [artistResults, setArtistResults] = useState<SpotifyArtist[]>([])
  const [artistSearching, setArtistSearching] = useState(false)
  const [selectedArtists, setSelectedArtists] = useState<SpotifyArtist[]>([])
  const artistDebounceRef = useRef<NodeJS.Timeout | null>(null)

  // Genre state
  const [selectedGenres, setSelectedGenres] = useState<GenreNode[]>([])
  const [openAnchors, setOpenAnchors] = useState<Set<string>>(new Set())

  const toggleAnchor = (id: string) => {
    setOpenAnchors((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  // Last.fm state
  const [lastfmUsername, setLastfmUsername] = useState("")

  const togglePath = (key: string) => {
    setOpenPaths((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  // Artist search debounce
  useEffect(() => {
    if (artistDebounceRef.current) clearTimeout(artistDebounceRef.current)
    if (!artistQuery.trim()) { setArtistResults([]); return }

    artistDebounceRef.current = setTimeout(async () => {
      setArtistSearching(true)
      try {
        const res = await fetch(`/api/onboarding/search?q=${encodeURIComponent(artistQuery.trim())}`)
        if (res.ok) {
          const data = await res.json()
          setArtistResults(data.artists ?? [])
        }
      } finally {
        setArtistSearching(false)
      }
    }, 350)

    return () => { if (artistDebounceRef.current) clearTimeout(artistDebounceRef.current) }
  }, [artistQuery])

  const selectedArtistIds = new Set(selectedArtists.map((a) => a.id))
  const selectedGenreIds = new Set(selectedGenres.map((g) => g.id))

  function addArtist(artist: SpotifyArtist) {
    if (!selectedArtistIds.has(artist.id) && selectedArtists.length < 10) {
      setSelectedArtists((prev) => [...prev, artist])
    }
  }

  function removeArtist(id: string) {
    setSelectedArtists((prev) => prev.filter((a) => a.id !== id))
  }

  function addGenre(genre: GenreNode) {
    if (!selectedGenreIds.has(genre.id) && selectedGenres.length < 20) {
      setSelectedGenres((prev) => [...prev, genre])
    }
  }

  function removeGenre(id: string) {
    setSelectedGenres((prev) => prev.filter((g) => g.id !== id))
  }

  const hasAnyInput =
    selectedArtists.length > 0 ||
    selectedGenres.length > 0 ||
    lastfmUsername.trim().length > 0

  async function handleContinue(skip = false) {
    if (saving) return
    setSaving(true)

    try {
      const promises: Promise<Response>[] = []

      // 1. Save Last.fm username
      if (!skip && lastfmUsername.trim()) {
        promises.push(fetch("/api/settings", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ lastfmUsername: lastfmUsername.trim() }),
        }))
      }

      // 2. Save selected genres
      if (!skip && selectedGenres.length > 0) {
        promises.push(fetch("/api/settings", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ selectedGenres: selectedGenres.map((g) => g.lastfmTag) }),
        }))
      }

      // 3. Save seed artists
      const artistsToSave = selectedArtists.slice(0, 5)
      if (!skip && artistsToSave.length >= 3) {
        promises.push(fetch("/api/onboarding/seeds", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ artistIds: artistsToSave.map((a) => a.id) }),
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
            <div className="col gap-10">
              {selectedArtists.length > 0 && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {selectedArtists.map((a) => (
                    <Chip key={a.id} label={a.name} onRemove={() => removeArtist(a.id)} />
                  ))}
                </div>
              )}
              <div className="field" style={{ height: 40, position: "relative" }}>
                <Search
                  size={14}
                  style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "var(--text-muted)", pointerEvents: "none" }}
                />
                <input
                  type="text"
                  placeholder="Search artists…"
                  value={artistQuery}
                  onChange={(e) => setArtistQuery(e.target.value)}
                  style={{ paddingLeft: 32 }}
                />
              </div>
              {artistSearching && (
                <div className="mono muted" style={{ fontSize: 11 }}>Searching…</div>
              )}
              {artistResults.length > 0 && (
                <div
                  style={{
                    maxHeight: 220,
                    overflowY: "auto",
                    display: "flex",
                    flexDirection: "column",
                    gap: 2,
                    borderRadius: 10,
                    border: "1px solid var(--border)",
                    background: "var(--bg-card)",
                  }}
                >
                  {artistResults.map((artist) => {
                    const already = selectedArtistIds.has(artist.id)
                    return (
                      <button
                        key={artist.id}
                        type="button"
                        disabled={already || selectedArtists.length >= 10}
                        onClick={() => addArtist(artist)}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 10,
                          padding: "9px 12px",
                          background: already ? "rgba(139,92,246,0.08)" : "transparent",
                          border: 0,
                          cursor: already ? "default" : "pointer",
                          textAlign: "left",
                          borderBottom: "1px solid var(--border)",
                        }}
                      >
                        {artist.imageUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={artist.imageUrl} alt="" style={{ width: 32, height: 32, borderRadius: 6, objectFit: "cover", flexShrink: 0 }} />
                        ) : (
                          <div style={{ width: 32, height: 32, borderRadius: 6, background: "rgba(255,255,255,0.06)", flexShrink: 0 }} />
                        )}
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 13, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                            {artist.name}
                          </div>
                          {artist.genres[0] && (
                            <div className="mono" style={{ fontSize: 10, color: "var(--text-muted)", textTransform: "uppercase" }}>
                              {artist.genres[0]}
                            </div>
                          )}
                        </div>
                        {already && (
                          <span style={{ fontSize: 11, color: "var(--accent)", flexShrink: 0 }}>added</span>
                        )}
                      </button>
                    )
                  })}
                </div>
              )}
              {selectedArtists.length > 0 && selectedArtists.length < 3 && (
                <div className="muted" style={{ fontSize: 11 }}>
                  Add {3 - selectedArtists.length} more to use this path
                </div>
              )}
            </div>
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
            <div className="col gap-6">
              {ALL_GENRES.map((anchor) => (
                <GenreAnchor
                  key={anchor.id}
                  anchor={anchor}
                  expanded={openAnchors.has(anchor.id)}
                  onToggleExpand={() => toggleAnchor(anchor.id)}
                  selectedIds={selectedGenreIds}
                  atCap={selectedGenres.length >= 20}
                  onToggleSelect={(node) =>
                    selectedGenreIds.has(node.id) ? removeGenre(node.id) : addGenre(node)
                  }
                />
              ))}
            </div>
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

          {/* ── Spotify (locked) ────────────────────────────────────── */}
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

// ── GenreAnchor ───────────────────────────────────────────────────────────────

function GenreAnchor({
  anchor,
  expanded,
  onToggleExpand,
  selectedIds,
  atCap,
  onToggleSelect,
}: {
  anchor: GenreNode
  expanded: boolean
  onToggleExpand: () => void
  selectedIds: Set<string>
  atCap: boolean
  onToggleSelect: (node: GenreNode) => void
}) {
  const parentSelected = selectedIds.has(anchor.id)
  const childSelectedCount = anchor.children.reduce(
    (n, c) => (selectedIds.has(c.id) ? n + 1 : n),
    0
  )
  const totalSelected = (parentSelected ? 1 : 0) + childSelectedCount

  return (
    <div
      style={{
        borderRadius: 10,
        border: "1px solid var(--border)",
        background: expanded ? "rgba(255,255,255,0.02)" : "transparent",
        overflow: "hidden",
        transition: "background 0.15s",
      }}
    >
      <button
        type="button"
        onClick={onToggleExpand}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          width: "100%",
          padding: "10px 12px",
          background: "none",
          border: 0,
          cursor: "pointer",
          textAlign: "left",
        }}
      >
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13.5, fontWeight: 600, display: "flex", alignItems: "center", gap: 8 }}>
            {anchor.label}
            {totalSelected > 0 && (
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
                {totalSelected}
              </span>
            )}
          </div>
          <div className="mono" style={{ fontSize: 10.5, color: "var(--text-muted)", marginTop: 2 }}>
            {anchor.children.length} sub-genres
          </div>
        </div>
        <div style={{ color: "var(--text-faint)", flexShrink: 0 }}>
          {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </div>
      </button>

      {expanded && (
        <div style={{ padding: "6px 8px 10px", borderTop: "1px solid var(--border)" }}>
          <GenreRow
            label={`Select all of ${anchor.label}`}
            selected={parentSelected}
            disabled={!parentSelected && atCap}
            onClick={() => onToggleSelect(anchor)}
            emphasis
          />
          {anchor.children.map((child) => {
            const sel = selectedIds.has(child.id)
            return (
              <GenreRow
                key={child.id}
                label={child.label}
                selected={sel}
                disabled={!sel && atCap}
                onClick={() => onToggleSelect(child)}
              />
            )
          })}
        </div>
      )}
    </div>
  )
}

// ── GenreRow ──────────────────────────────────────────────────────────────────

function GenreRow({
  label,
  selected,
  disabled,
  onClick,
  emphasis,
}: {
  label: string
  selected: boolean
  disabled?: boolean
  onClick: () => void
  emphasis?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        width: "100%",
        padding: "8px 10px",
        background: selected ? "var(--accent-soft)" : "transparent",
        border: 0,
        borderRadius: 8,
        cursor: disabled ? "not-allowed" : "pointer",
        textAlign: "left",
        color: disabled ? "var(--text-faint)" : "var(--text-primary)",
        opacity: disabled ? 0.5 : 1,
      }}
    >
      <span
        aria-hidden
        style={{
          width: 14,
          height: 14,
          borderRadius: "50%",
          border: `1.5px solid ${selected ? "var(--accent)" : "var(--border-strong)"}`,
          background: selected ? "var(--accent)" : "transparent",
          flexShrink: 0,
          boxShadow: selected ? "0 0 8px var(--accent-glow)" : "none",
          transition: "all 0.12s",
        }}
      />
      <span style={{ fontSize: 13, fontWeight: emphasis ? 600 : 500 }}>{label}</span>
    </button>
  )
}
