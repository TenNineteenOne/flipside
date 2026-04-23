"use client"

import { useState } from "react"
import { signOut } from "next-auth/react"
import { toast } from "sonner"
import { IdenticonAvatar } from "@/components/ui/identicon-avatar"
import { LibraryEditor } from "@/components/settings/library-editor"
import { CurvePreview } from "@/components/settings/curve-preview"
import { PlatformPicker } from "@/components/settings/platform-picker"
import { Ambient } from "@/components/visual/ambient"
import { hexToRgba } from "@/lib/color-utils"
import type { SpotifyArtist } from "@/components/onboarding/artist-search"
import type { MusicPlatform } from "@/lib/music-links"

interface SettingsFormProps {
  userSeed: string
  initialPlayThreshold: number
  initialPopularityCurve: number
  initialLastfmUsername: string | null
  initialStatsfmUsername: string | null
  initialLastfmArtistCount: number
  initialUndergroundMode: boolean
  initialDeepDiscovery: boolean
  initialAdventurous: boolean
  initialSelectedGenres: string[]
  initialSeedArtists: SpotifyArtist[]
  initialMusicPlatform: MusicPlatform
  exampleArtists: { popularity: number; artist: { name: string; popularity: number } | null }[]
}

async function patchSettings(payload: Record<string, unknown>) {
  const res = await fetch("/api/settings", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  })
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error((data as { error?: string }).error ?? "Failed to save")
  }
}

/**
 * Translate a failed feed regenerate response into an actionable toast.
 * Explore has no cooldown, so when the combined regenerate lands during the
 * feed's 30s cooldown the user used to see a vague "Explore rebuilt, but feed
 * failed" — now they see the actual reason.
 */
async function describeFeedFailure(res: Response): Promise<string> {
  const data = (await res.json().catch(() => ({}))) as { error?: string }
  const msg = (data.error ?? "").toLowerCase()
  if (res.status === 429) {
    if (msg.includes("discovery queue") || msg.includes("queue")) {
      return "Queue is full — review some artists first"
    }
    return "Cooling down — wait a few seconds and try again"
  }
  if (res.status === 503) {
    return "Music service temporarily unavailable — try again in a moment"
  }
  return "Explore rebuilt, but feed failed"
}

const ACCENT = "#8b5cf6"
const MINT = "#7dd9c6"
const BLUE = "#a8c7fa"
const AMBER = "#f5b047"
const ROSE = "#ec6fb5"
const LASTFM_RED = "#d7002a"
const STATSFM_PURPLE = "#8b5cf6"

// Obscurity model: threshold maps directly to the mock's four-stop ladder.
// Low threshold = strict niche cap = "Deep underground". High threshold = loose
// familiarity cap = "Familiar". Same copy as before; labels refreshed to the
// design's crisper framing. DB column stays `play_threshold`.
function obscurityLabel(t: number): string {
  if (t < 5) return "Deep underground"
  if (t < 15) return "Offbeat"
  if (t < 30) return "Curious"
  return "Familiar"
}
function obscurityHelp(t: number): string {
  if (t < 5) return "Almost nothing you\u2019ve heard before will appear."
  if (t < 15) return "Mostly unfamiliar names with the occasional half-known artist."
  if (t < 30) return "A balanced mix \u2014 some discovery, some comfort."
  return "Includes artists you already play often."
}
function obscurityColor(t: number): string {
  if (t < 5) return MINT
  if (t < 15) return BLUE
  if (t < 30) return ACCENT
  return AMBER
}

export function SettingsForm({
  userSeed,
  initialPlayThreshold,
  initialPopularityCurve,
  initialLastfmUsername,
  initialStatsfmUsername,
  initialLastfmArtistCount,
  initialUndergroundMode,
  initialDeepDiscovery,
  initialAdventurous,
  initialSelectedGenres,
  initialSeedArtists,
  initialMusicPlatform,
  exampleArtists,
}: SettingsFormProps) {
  const [threshold, setThreshold] = useState(initialPlayThreshold)
  const [popularityCurve, setPopularityCurve] = useState(initialPopularityCurve)
  const [lastfmUsername, setLastfmUsername] = useState(initialLastfmUsername ?? "")
  const [statsfmUsername, setStatsfmUsername] = useState(initialStatsfmUsername ?? "")
  const [undergroundMode, setUndergroundMode] = useState(initialUndergroundMode)
  const [deepDiscovery, setDeepDiscovery] = useState(initialDeepDiscovery)
  const [adventurous, setAdventurous] = useState(initialAdventurous)
  const [musicPlatform, setMusicPlatform] = useState<MusicPlatform>(initialMusicPlatform)
  const [syncingSource, setSyncingSource] = useState<null | "lastfm" | "statsfm">(null)
  const [isGenerating, setIsGenerating] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState(false)

  const isConnected = lastfmUsername.trim().length > 0
  const isStatsfmConnected = statsfmUsername.trim().length > 0

  const obsColor = obscurityColor(threshold)
  const obsLabel = obscurityLabel(threshold)
  const obsHelp = obscurityHelp(threshold)
  const obsPct = Math.round((threshold / 50) * 100)
  const obsSliderBg = `linear-gradient(to right, ${obsColor} ${obsPct}%, rgba(255,255,255,0.10) ${obsPct}%)`

  const curvePct = Math.round(((popularityCurve - 0.9) / 0.1) * 100)
  const curveBg = `linear-gradient(to right, var(--accent) ${curvePct}%, rgba(255,255,255,0.10) ${curvePct}%)`
  const curveLabel =
    popularityCurve < 0.92 ? "Niche only"
    : popularityCurve < 0.95 ? "Mostly niche"
    : popularityCurve < 0.97 ? "Balanced"
    : popularityCurve < 0.99 ? "Mostly popular"
    : "Mainstream"
  const curveHelp =
    popularityCurve < 0.92
      ? "The steepest curve — popularity is punished hard. Expect deep cuts only."
      : popularityCurve < 0.95
      ? "Obscurity is strongly preferred, with room for a few less-obvious names."
      : popularityCurve < 0.97
      ? "Default mix \u2014 obscurity wins, but not by a landslide."
      : popularityCurve < 0.99
      ? "Popularity barely hurts. Expect familiar names alongside some discoveries."
      : "The curve flattens — popularity is nearly ignored."

  const palette = `
    radial-gradient(50% 40% at 18% 20%, ${hexToRgba(ACCENT, 0.20)} 0%, transparent 70%),
    radial-gradient(55% 45% at 82% 35%, ${hexToRgba(MINT, 0.14)} 0%, transparent 70%),
    radial-gradient(60% 50% at 50% 95%, ${hexToRgba(ROSE, 0.12)} 0%, transparent 70%)
  `

  async function handleThresholdRelease() {
    try {
      await patchSettings({ playThreshold: threshold })
    } catch {
      toast.error("Failed to save familiarity")
    }
  }

  async function handleCurveRelease() {
    try {
      await patchSettings({ popularityCurve })
    } catch {
      toast.error("Failed to save popularity preference")
    }
  }

  async function handleUndergroundToggle() {
    const next = !undergroundMode
    setUndergroundMode(next)
    try {
      await patchSettings({ undergroundMode: next })
      void handleRegenerateBoth()
    } catch {
      setUndergroundMode(!next)
      toast.error("Failed to save setting")
    }
  }

  async function handleDeepDiscoveryToggle() {
    const next = !deepDiscovery
    setDeepDiscovery(next)
    try {
      await patchSettings({ deepDiscovery: next })
      void handleRegenerateBoth()
    } catch {
      setDeepDiscovery(!next)
      toast.error("Failed to save setting")
    }
  }

  async function handleAdventurousToggle() {
    const next = !adventurous
    setAdventurous(next)
    try {
      await patchSettings({ adventurous: next })
      try {
        localStorage.setItem("flipside.adventurous", next ? "1" : "0")
        window.dispatchEvent(new Event("flipside:adventurous-change"))
      } catch { /* noop */ }
      void handleRegenerateBoth()
    } catch {
      setAdventurous(!next)
      toast.error("Failed to save setting")
    }
  }

  async function handleMusicPlatformChange(next: MusicPlatform) {
    if (next === musicPlatform) return
    const prev = musicPlatform
    setMusicPlatform(next)
    try {
      await patchSettings({ preferredMusicPlatform: next })
      toast.success("Saved")
    } catch {
      setMusicPlatform(prev)
      toast.error("Failed to save preference")
    }
  }

  async function handleLastfmBlur() {
    const trimmed = lastfmUsername.trim()
    if (trimmed === (initialLastfmUsername ?? "")) return
    try {
      await patchSettings({ lastfmUsername: trimmed })
      toast.success("Last.fm username saved")
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save Last.fm username")
    }
  }

  async function handleStatsfmBlur() {
    const trimmed = statsfmUsername.trim()
    if (trimmed === (initialStatsfmUsername ?? "")) return
    try {
      await patchSettings({ statsfmUsername: trimmed })
      toast.success("stats.fm username saved")
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save stats.fm username")
    }
  }

  async function handleDeleteAccount() {
    if (!deleteConfirm) {
      setDeleteConfirm(true)
      return
    }
    setIsDeleting(true)
    try {
      const res = await fetch("/api/account", { method: "DELETE" })
      if (!res.ok && !res.redirected) {
        throw new Error("Delete failed")
      }
      window.location.href = "/"
    } catch {
      toast.error("Failed to delete account")
      setIsDeleting(false)
      setDeleteConfirm(false)
    }
  }

  async function handleRegenerateBoth() {
    if (isGenerating) return
    setIsGenerating(true)
    try {
      const [feedRes, exploreRes] = await Promise.all([
        fetch("/api/recommendations/generate?replace=true", { method: "POST" }),
        fetch("/api/explore/generate?force=true", { method: "POST" }),
      ])

      if (feedRes.ok) {
        const data = (await feedRes.json().catch(() => ({}))) as {
          softenedFilters?: { playThreshold?: boolean; coldStart?: boolean }
        }
        if (data.softenedFilters) {
          const s = data.softenedFilters
          const bits: string[] = []
          if (s.coldStart) bits.push("falling back to starter picks")
          else if (s.playThreshold) bits.push("loosening the familiarity cap")
          if (bits.length > 0) {
            toast(`Widened the search for this batch — ${bits.join(" and ")}.`)
          }
        }
      }

      if (!feedRes.ok && !exploreRes.ok) {
        toast.error("Couldn't rebuild — try again")
      } else if (!feedRes.ok) {
        toast.error(await describeFeedFailure(feedRes))
      } else if (!exploreRes.ok) {
        toast.error("Feed rebuilt, but Explore failed")
      } else {
        toast.success("Feed & Explore rebuilt")
      }
    } catch {
      toast.error("Couldn't rebuild — try again")
    } finally {
      setIsGenerating(false)
    }
  }

  async function handleSync(source: "lastfm" | "statsfm") {
    if (syncingSource) return
    if (source === "lastfm" && !isConnected) return
    if (source === "statsfm" && !isStatsfmConnected) return
    setSyncingSource(source)
    try {
      const res = await fetch("/api/history/accumulate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error((data as { error?: string }).error ?? "Sync failed")
      }
      toast.success(`${source === "lastfm" ? "Last.fm" : "stats.fm"} sync complete`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Sync failed")
    } finally {
      setSyncingSource(null)
    }
  }

  function ToggleSwitch({ checked, onClick, tint = ACCENT }: { checked: boolean; onClick: () => void; tint?: string }) {
    return (
      <button
        onClick={onClick}
        role="switch"
        aria-checked={checked}
        style={{
          width: 48,
          height: 28,
          borderRadius: 14,
          border: 0,
          cursor: "pointer",
          flexShrink: 0,
          background: checked ? tint : "rgba(255,255,255,0.10)",
          position: "relative",
          transition: "background 0.2s",
          boxShadow: checked ? `0 0 16px ${hexToRgba(tint, 0.45)}` : "none",
        }}
      >
        <div
          style={{
            width: 22,
            height: 22,
            borderRadius: "50%",
            background: "#fff",
            position: "absolute",
            top: 3,
            left: checked ? 23 : 3,
            transition: "left 0.2s",
          }}
        />
      </button>
    )
  }

  return (
    <>
      <style>{`
        .obs-slider {
          -webkit-appearance: none;
          appearance: none;
          width: 100%;
          height: 4px;
          border-radius: 2px;
          outline: none;
          cursor: pointer;
        }
        .obs-slider::-webkit-slider-thumb {
          -webkit-appearance: none;
          width: 16px; height: 16px;
          border-radius: 50%;
          background: var(--accent);
          border: none;
          cursor: pointer;
        }
        .obs-slider::-moz-range-thumb {
          width: 16px; height: 16px;
          border-radius: 50%;
          background: var(--accent);
          border: none;
          cursor: pointer;
        }
      `}</style>

      <Ambient palette={palette} />

      <div>
        <div className="page-head">
          <h1>Settings</h1>
          <span className="sub">
            <span className="serif" style={{ fontSize: 15, color: "var(--text-secondary)" }}>
              Your preferences, politely tuned.
            </span>
            <span style={{ display: "block", marginTop: 4 }}>no email · no password</span>
          </span>
        </div>

        <div className="col gap-16" style={{ marginTop: 8 }}>

          {/* ── Profile ─────────────────────────────────────────────── */}
          <div>
            <div className="eyebrow" style={{ marginBottom: 10, color: ACCENT }}>Profile</div>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 14,
                padding: "16px 18px",
                borderRadius: "var(--radius-lg)",
                background: `linear-gradient(135deg, ${hexToRgba(ACCENT, 0.10)} 0%, rgba(15,15,15,0.65) 60%)`,
                backdropFilter: "blur(30px) saturate(1.1)",
                WebkitBackdropFilter: "blur(30px) saturate(1.1)",
                border: `1px solid ${hexToRgba(ACCENT, 0.22)}`,
              }}
            >
              <div style={{ position: "relative" }}>
                <IdenticonAvatar seed={userSeed} size={48} />
                <span
                  aria-hidden
                  style={{
                    position: "absolute",
                    bottom: -2,
                    right: -2,
                    width: 14,
                    height: 14,
                    borderRadius: "50%",
                    background: MINT,
                    border: "2px solid var(--bg-base)",
                  }}
                />
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 15, fontWeight: 700 }}>Your profile</div>
              </div>
            </div>
          </div>

          {/* ── How underground? (Obscurity) ────────────────────────── */}
          <div>
            <div className="eyebrow" style={{ marginBottom: 10, color: obsColor }}>How underground?</div>
            <div
              className="fs-card col gap-16"
              style={{
                background: `linear-gradient(135deg, ${hexToRgba(obsColor, 0.12)} 0%, rgba(15,15,15,0.65) 70%)`,
                borderColor: hexToRgba(obsColor, 0.24),
                transition: "background 0.6s, border-color 0.6s",
              }}
            >
              <div>
                <div
                  style={{
                    display: "flex",
                    alignItems: "baseline",
                    justifyContent: "space-between",
                    marginBottom: 14,
                  }}
                >
                  <div
                    className="serif"
                    style={{
                      fontSize: 24,
                      color: obsColor,
                      letterSpacing: "-0.01em",
                      fontWeight: 500,
                      transition: "color 0.4s",
                    }}
                  >
                    {obsLabel}
                  </div>
                  <div className="mono" style={{ fontSize: 11, color: "var(--text-muted)" }}>
                    hide if played &gt; {threshold}&times;
                  </div>
                </div>
                <input
                  type="range"
                  className="obs-slider"
                  min={0}
                  max={50}
                  step={1}
                  value={threshold}
                  onChange={(e) => setThreshold(Number(e.target.value))}
                  onPointerUp={handleThresholdRelease}
                  onKeyUp={handleThresholdRelease}
                  style={{ background: obsSliderBg }}
                />
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    marginTop: 8,
                    fontFamily: "var(--font-mono)",
                    fontSize: 10.5,
                    color: "var(--text-muted)",
                    textTransform: "uppercase",
                    letterSpacing: "0.1em",
                  }}
                >
                  <span>&larr; deep underground</span>
                  <span>familiar &rarr;</span>
                </div>
                <div className="muted" style={{ fontSize: 12, marginTop: 10, lineHeight: 1.5 }}>
                  {obsHelp}
                </div>
              </div>

              <div className="divider" />

              {/* Fine-tune sub-controls */}
              <div className="eyebrow" style={{ color: "var(--text-muted)" }}>Fine-tune</div>

              {/* Popularity curve */}
              <div>
                <div
                  style={{
                    display: "flex",
                    alignItems: "baseline",
                    justifyContent: "space-between",
                    marginBottom: 12,
                  }}
                >
                  <div style={{ fontSize: 14, fontWeight: 600 }}>{curveLabel}</div>
                  <div className="mono" style={{ fontSize: 11, color: "var(--text-muted)" }}>
                    k = {popularityCurve.toFixed(3)}
                  </div>
                </div>
                <input
                  type="range"
                  className="obs-slider"
                  min={0.9}
                  max={1.0}
                  step={0.005}
                  value={popularityCurve}
                  onChange={(e) => setPopularityCurve(Number(e.target.value))}
                  onPointerUp={handleCurveRelease}
                  onKeyUp={handleCurveRelease}
                  style={{ background: curveBg }}
                />
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    marginTop: 8,
                    fontFamily: "var(--font-mono)",
                    fontSize: 10.5,
                    color: "var(--text-muted)",
                    textTransform: "uppercase",
                    letterSpacing: "0.1em",
                  }}
                >
                  <span>&larr; niche</span>
                  <span>mainstream &rarr;</span>
                </div>
                <div className="muted" style={{ fontSize: 12, marginTop: 10, lineHeight: 1.5 }}>
                  {curveHelp}
                </div>
              </div>

              <CurvePreview
                popularityCurve={popularityCurve}
                undergroundMode={undergroundMode}
                adventurous={adventurous}
                exampleArtists={exampleArtists}
              />

              <div className="divider" />

              {/* Extra obscure */}
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>Extra obscure</div>
                  <div className="muted" style={{ fontSize: 12, lineHeight: 1.5 }}>
                    Drops every artist above pop 50 entirely, and penalizes the rest on top of the curve above.
                  </div>
                </div>
                <ToggleSwitch checked={undergroundMode} onClick={handleUndergroundToggle} />
              </div>

              <div className="divider" />

              {/* Deep discovery */}
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>Deep discovery</div>
                  <div className="muted" style={{ fontSize: 12, lineHeight: 1.5 }}>
                    Walks two artists deep into similar-artist chains. More obscure picks; occasional genre drift.
                  </div>
                </div>
                <ToggleSwitch checked={deepDiscovery} onClick={handleDeepDiscoveryToggle} />
              </div>

              <div className="divider" />

              {/* Adventurous mode */}
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4, color: adventurous ? AMBER : undefined, transition: "color 0.3s" }}>
                    Adventurous mode
                  </div>
                  <div className="muted" style={{ fontSize: 12, lineHeight: 1.5 }}>
                    Pulls in adjacent genres, adds extra variety, and leads with less-familiar picks across your feed and Explore.
                  </div>
                </div>
                <ToggleSwitch checked={adventurous} onClick={handleAdventurousToggle} tint={AMBER} />
              </div>

              <button
                onClick={handleRegenerateBoth}
                disabled={isGenerating}
                className="btn"
                style={{
                  width: "100%",
                  marginTop: 4,
                  color: "#0a0a0a",
                  fontWeight: 600,
                  border: 0,
                  cursor: isGenerating ? "default" : "pointer",
                  opacity: isGenerating ? 0.75 : 1,
                  background: adventurous
                    ? "linear-gradient(135deg, rgba(245,176,71,0.95) 0%, rgba(236,111,181,0.85) 45%, rgba(125,217,198,0.75) 80%, rgba(168,199,250,0.70) 100%)"
                    : AMBER,
                  boxShadow: adventurous ? "0 0 24px rgba(245,176,71,0.28)" : "none",
                  transition: "background 0.3s, box-shadow 0.3s",
                }}
              >
                {isGenerating ? "Regenerating…" : "Regenerate feed & Explore →"}
              </button>
            </div>
          </div>

          {/* ── Seeds ──────────────────────────────────────────────── */}
          <div>
            <div className="eyebrow" style={{ marginBottom: 10 }}>Seeds</div>
            <div className="fs-card">
              <LibraryEditor
                initialGenreTags={initialSelectedGenres}
                initialSeedArtists={initialSeedArtists}
                flat
              />
            </div>
          </div>

          {/* ── Connected sources ──────────────────────────────────── */}
          <div>
            <div className="eyebrow" style={{ marginBottom: 10 }}>Connected sources</div>
            <div className="fs-card col gap-14">
              {/* Last.fm */}
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <div
                  style={{
                    width: 34,
                    height: 34,
                    borderRadius: 8,
                    background: hexToRgba(LASTFM_RED, 0.12),
                    color: "#ff6b6b",
                    border: `1px solid ${hexToRgba(LASTFM_RED, 0.24)}`,
                    display: "grid",
                    placeItems: "center",
                    fontSize: 16,
                    fontWeight: 700,
                    flexShrink: 0,
                  }}
                >
                  ♫
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 14, fontWeight: 600 }}>Last.fm</div>
                  <div
                    className="mono"
                    style={{
                      fontSize: 11,
                      color: isConnected ? MINT : "var(--text-muted)",
                    }}
                  >
                    {isConnected
                      ? `connected · @${lastfmUsername.trim()} · ${initialLastfmArtistCount} artists`
                      : "not connected"}
                  </div>
                  <div className="field" style={{ height: 40, marginTop: 8 }}>
                    <input
                      type="text"
                      placeholder="your-lastfm-username"
                      value={lastfmUsername}
                      onChange={(e) => setLastfmUsername(e.target.value)}
                      onBlur={handleLastfmBlur}
                    />
                  </div>
                </div>
                <button
                  className="btn btn-sm"
                  onClick={() => handleSync("lastfm")}
                  disabled={syncingSource !== null || !isConnected}
                  style={{ flexShrink: 0, opacity: !isConnected ? 0.4 : 1 }}
                >
                  {syncingSource === "lastfm" ? "Syncing…" : "Sync now"}
                </button>
              </div>

              <div className="divider" />

              {/* stats.fm */}
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <div
                  style={{
                    width: 34,
                    height: 34,
                    borderRadius: 8,
                    background: hexToRgba(STATSFM_PURPLE, 0.12),
                    color: STATSFM_PURPLE,
                    border: `1px solid ${hexToRgba(STATSFM_PURPLE, 0.24)}`,
                    display: "grid",
                    placeItems: "center",
                    fontSize: 15,
                    flexShrink: 0,
                  }}
                >
                  📊
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 14, fontWeight: 600 }}>stats.fm</div>
                  <div
                    className="mono"
                    style={{
                      fontSize: 11,
                      color: isStatsfmConnected ? MINT : "var(--text-muted)",
                    }}
                  >
                    {isStatsfmConnected
                      ? `connected · @${statsfmUsername.trim()}`
                      : "not connected"}
                  </div>
                  <div className="field" style={{ height: 40, marginTop: 8 }}>
                    <input
                      type="text"
                      placeholder="your-statsfm-username"
                      value={statsfmUsername}
                      onChange={(e) => setStatsfmUsername(e.target.value)}
                      onBlur={handleStatsfmBlur}
                    />
                  </div>
                </div>
                <button
                  className="btn btn-sm"
                  onClick={() => handleSync("statsfm")}
                  disabled={syncingSource !== null || !isStatsfmConnected}
                  style={{ flexShrink: 0, opacity: !isStatsfmConnected ? 0.4 : 1 }}
                >
                  {syncingSource === "statsfm" ? "Syncing…" : "Sync now"}
                </button>
              </div>

              <div
                className="muted"
                style={{ fontSize: 11, lineHeight: 1.5, marginTop: 4 }}
              >
                Your Last.fm and stats.fm usernames are encrypted at rest. We keep
                them recoverable because we need the originals to call Last.fm and
                stats.fm on sync — they&rsquo;re public handles, not credentials.
              </div>
            </div>
          </div>

          {/* ── Where do you listen? ────────────────────────────────── */}
          <div>
            <div className="eyebrow" style={{ marginBottom: 10 }}>Where do you listen?</div>
            <div className="fs-card col gap-12">
              <PlatformPicker value={musicPlatform} onChange={handleMusicPlatformChange} />
              <div className="muted" style={{ fontSize: 12, lineHeight: 1.5 }}>
                Pick the app where you want to open and save artists. We&rsquo;ll only link out —{" "}
                <strong style={{ color: "var(--text-secondary)" }}>we won&rsquo;t ask for your Apple Music or YouTube Music login.</strong>
              </div>
            </div>
          </div>

          {/* ── Account ─────────────────────────────────────────────── */}
          <div>
            <div className="eyebrow" style={{ marginBottom: 10 }}>Account</div>
            <div className="fs-card col gap-12">
              <button
                className="btn"
                onClick={() => signOut({ callbackUrl: "/" })}
              >
                Sign out
              </button>
              <button
                className="btn"
                onClick={handleDeleteAccount}
                disabled={isDeleting}
                style={{ color: "#ff7b7b", borderColor: "rgba(255,75,75,0.2)" }}
              >
                {isDeleting
                  ? "Deleting…"
                  : deleteConfirm
                  ? "Are you sure? Tap again to confirm"
                  : "Forget my account permanently"}
              </button>
              <div className="muted" style={{ fontSize: 11.5, lineHeight: 1.5 }}>
                No email. No password. If you forget your username, your account is gone.
              </div>
            </div>
          </div>

        </div>
      </div>
    </>
  )
}
