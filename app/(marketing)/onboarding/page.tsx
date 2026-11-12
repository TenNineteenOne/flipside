"use client"

import { useEffect, useState } from "react"
import dynamic from "next/dynamic"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Music, ChevronDown, ChevronUp } from "lucide-react"
import type { GenreNode } from "@/lib/types"
import { ArtistSearch, type SpotifyArtist } from "@/components/onboarding/artist-search"
import { PlatformPicker } from "@/components/settings/platform-picker"
import { DEFAULT_MUSIC_PLATFORM, type MusicPlatform } from "@/lib/music-links"
import { postGenerate } from "@/lib/client/feed-generation"
import { MAX_SELECTED_GENRES, patchSettings, SettingsSaveError, type SettingsPatch, LASTFM_USERNAME_RE, STATSFM_USERNAME_RE } from "@/lib/settings/patch-settings"
import { Wordmark } from "@/components/shell/wordmark"

// Split out of the first load: the picker carries the genre tree (data/genres-picker.json), the
// bulk of this page's JS otherwise. Fetched once the browser is idle, or when the Genres card opens
// first. The import() stays inside dynamic() (as in feed-client.tsx) and the loader is kept by
// reference for the preload, so both fetch the same chunk.
let loadGenrePicker: () => Promise<unknown> = () => Promise.resolve()
const keep = <T,>(load: () => Promise<T>) => ((loadGenrePicker = load), load)
const GenrePicker = dynamic(
  keep(() => import("@/components/onboarding/genre-picker").then((m) => m.GenrePicker)),
  {
    ssr: false,
    loading: () => (
      <div className="col gap-10" aria-busy="true">
        <div className="fs-skeleton" style={{ height: 36, borderRadius: 8 }} />
        <div className="fs-skeleton" style={{ height: 36, borderRadius: 8 }} />
      </div>
    ),
  },
)

const ARTIST_CAP = 200
const GENRE_CAP = MAX_SELECTED_GENRES
/** app/api/onboarding/seeds validates `{ min: 3 }`. */
const MIN_SEEDS = 3

// ── Main component ────────────────────────────────────────────────────────────

export default function OnboardingPage() {
  const router = useRouter()
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    const preload = () => void loadGenrePicker().catch(() => {})
    // Safari before 18 has no requestIdleCallback.
    if (typeof requestIdleCallback !== "function") {
      const t = window.setTimeout(preload, 2000)
      return () => clearTimeout(t)
    }
    const id = requestIdleCallback(preload, { timeout: 5000 })
    return () => cancelIdleCallback(id)
  }, [])

  // Active paths (can expand multiple)
  const [openPaths, setOpenPaths] = useState<Set<string>>(new Set())

  const [selectedArtists, setSelectedArtists] = useState<SpotifyArtist[]>([])
  const [selectedGenres, setSelectedGenres] = useState<GenreNode[]>([])
  const [lastfmUsername, setLastfmUsername] = useState("")
  const [statsfmUsername, setStatsfmUsername] = useState("")
  const [musicPlatform, setMusicPlatform] = useState<MusicPlatform>(DEFAULT_MUSIC_PLATFORM)

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
  // POST /api/onboarding/seeds rejects fewer than MIN_SEEDS, so 1–2 picks
  // would be silently dropped: block "Get started" until they add more or remove them.
  const artistsShort = selectedArtists.length > 0 && selectedArtists.length < MIN_SEEDS
  // The settings PATCH is all-or-nothing: one malformed username 400s it and
  // drops onboardingCompleted too, so the resume redirect would bounce back here.
  const lastfmInvalid = lastfmUsername.trim() !== "" && !LASTFM_USERNAME_RE.test(lastfmUsername.trim())
  const statsfmInvalid = statsfmUsername.trim() !== "" && !STATSFM_USERNAME_RE.test(statsfmUsername.trim())

  async function handleContinue(skip = false) {
    if (saving) return
    setSaving(true)

    try {
      // Each write resolves to whether the server accepted it; a network
      // failure rejects (→ the generic error below).
      const promises: Promise<boolean>[] = []

      const settingsPayload: SettingsPatch = {}
      // Always persist the platform choice (even on skip) so outbound links
      // reflect the user's selection on the very first feed view. Default is
      // Spotify so the value is never unexpected if the user didn't touch it.
      settingsPayload.preferredMusicPlatform = musicPlatform
      // Stamp completion so /feed's onboarding-resume check doesn't bounce the
      // user back here. Applies to both the normal flow and explicit skip.
      settingsPayload.onboardingCompleted = true
      if (!skip && lastfmUsername.trim()) settingsPayload.lastfmUsername = lastfmUsername.trim()
      if (!skip && statsfmUsername.trim()) settingsPayload.statsfmUsername = statsfmUsername.trim()
      if (!skip && selectedGenres.length > 0) {
        settingsPayload.selectedGenres = selectedGenres.map((g) => g.lastfmTag)
      }
      if (Object.keys(settingsPayload).length > 0) {
        promises.push(
          patchSettings(settingsPayload).then(
            () => true,
            (err) => {
              if (err instanceof SettingsSaveError) return false
              throw err
            },
          ),
        )
      }

      const artistsToSave = selectedArtists.slice(0, ARTIST_CAP)
      if (!skip && artistsToSave.length >= MIN_SEEDS) {
        promises.push(fetch("/api/onboarding/seeds", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            artists: artistsToSave.map((a) => ({ id: a.id, name: a.name, imageUrl: a.imageUrl })),
          }),
        }).then((r) => r.ok))
      }

      const results = await Promise.all(promises)
      if (results.includes(false)) {
        toast.error("Some settings couldn't be saved. You can update them later.")
      }

      // Kick off recommendation generation now (non-awaited) so it overlaps with
      // navigation and is underway/done by the time the feed mounts. Cooldown-
      // safe: if the feed's loader also fires, it gets a 429 and polls (see
      // loaderAction / RecommendationsLoader). If seeds were saved above
      // (non-skip path) the engine sees them on this run; on skip it
      // cold-starts, which is the intended "show something" behavior.
      // postGenerate never throws; the result is deliberately ignored.
      void postGenerate()

      // replace: Back must not reopen onboarding (its layout would bounce it to /feed anyway).
      router.replace("/feed")
    } catch {
      toast.error("Something went wrong. Try again.")
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
      <div style={{ position: "relative", zIndex: 1, width: "100%", maxWidth: 480 }}>

        {/* Header */}
        <div style={{ marginBottom: 32, textAlign: "center" }}>
          <div style={{ display: "flex", justifyContent: "center", marginBottom: 12 }}>
            <Wordmark />
          </div>
          <div className="serif" style={{ fontSize: 26, lineHeight: 1.25 }}>
            Seed your feed
          </div>
        </div>

        {/* ── Where do you listen? ───────────────────────────────── */}
        <div
          className="fs-card col gap-10"
          style={{ marginBottom: 16, padding: 16 }}
        >
          <div style={{ fontSize: 14, fontWeight: 600 }}>Where do you listen?</div>
          <PlatformPicker value={musicPlatform} onChange={setMusicPlatform} />
          <div className="muted" style={{ fontSize: 11.5, lineHeight: 1.5 }}>
            Flipside links out to it and never asks for your login.
          </div>
        </div>

        {/* Path cards */}
        <div className="col gap-12">

          {/* ── Artist search ───────────────────────────────────────── */}
          <PathCard
            icon={<Music size={16} />}
            title="Artists I like"
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
                  autoCapitalize="none"
                  autoCorrect="off"
                  aria-invalid={lastfmInvalid || undefined}
                />
              </div>
              {lastfmInvalid && (
                <div role="alert" style={{ fontSize: 11.5, color: "var(--dislike)" }}>
                  That doesn&rsquo;t look like a Last.fm username.
                </div>
              )}
              <div className="muted" style={{ fontSize: 11.5, lineHeight: 1.5 }}>
                Used to skip artists you already know. Stored encrypted.
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
                  autoCapitalize="none"
                  autoCorrect="off"
                  aria-invalid={statsfmInvalid || undefined}
                />
              </div>
              {statsfmInvalid && (
                <div role="alert" style={{ fontSize: 11.5, color: "var(--dislike)" }}>
                  That doesn&rsquo;t look like a stats.fm username.
                </div>
              )}
              <div className="muted" style={{ fontSize: 11.5, lineHeight: 1.5 }}>
                Your stats.fm profile must be public. Used to skip artists you already know. Stored encrypted.
              </div>
            </div>
          </PathCard>

        </div>

        {/* Actions */}
        <div className="col gap-10" style={{ marginTop: 28 }}>
          {artistsShort && (
            <div className="muted" role="status" style={{ fontSize: 11, textAlign: "center" }}>
              Add {MIN_SEEDS - selectedArtists.length} more artist{MIN_SEEDS - selectedArtists.length === 1 ? "" : "s"} to use that path, or remove {selectedArtists.length === 1 ? "it" : "them"}
            </div>
          )}
          <button
            className="btn btn-primary btn-block"
            onClick={() => handleContinue(false)}
            disabled={!hasAnyInput || artistsShort || lastfmInvalid || statsfmInvalid || saving}
            style={{ height: 48, fontSize: 15 }}
          >
            {saving ? "Saving…" : "Get started"}
          </button>
          <button
            className="btn btn-block"
            onClick={() => handleContinue(true)}
            disabled={saving}
            style={{ height: 44, fontSize: 14, color: "var(--text-muted)", borderColor: "var(--border)" }}
          >
            Skip
          </button>
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
  subtitle?: string
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
          {subtitle && <div className="muted" style={{ fontSize: 11.5, marginTop: 2 }}>{subtitle}</div>}
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
