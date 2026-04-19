"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { signOut } from "next-auth/react"
import { toast } from "sonner"
import { IdenticonAvatar } from "@/components/ui/identicon-avatar"
import { LibraryEditor } from "@/components/settings/library-editor"
import { CurvePreview } from "@/components/settings/curve-preview"
import type { SpotifyArtist } from "@/components/onboarding/artist-search"

interface SettingsFormProps {
  userSeed: string
  initialPlayThreshold: number
  initialPopularityCurve: number
  initialLastfmUsername: string | null
  initialStatsfmUsername: string | null
  initialLastfmArtistCount: number
  initialUndergroundMode: boolean
  initialSelectedGenres: string[]
  initialSeedArtists: SpotifyArtist[]
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

export function SettingsForm({
  userSeed,
  initialPlayThreshold,
  initialPopularityCurve,
  initialLastfmUsername,
  initialStatsfmUsername,
  initialLastfmArtistCount,
  initialUndergroundMode,
  initialSelectedGenres,
  initialSeedArtists,
  exampleArtists,
}: SettingsFormProps) {
  const router = useRouter()
  const [threshold, setThreshold] = useState(initialPlayThreshold)
  const [popularityCurve, setPopularityCurve] = useState(initialPopularityCurve)
  const [lastfmUsername, setLastfmUsername] = useState(initialLastfmUsername ?? "")
  const [statsfmUsername, setStatsfmUsername] = useState(initialStatsfmUsername ?? "")
  const [undergroundMode, setUndergroundMode] = useState(initialUndergroundMode)
  const [syncingSource, setSyncingSource] = useState<null | "lastfm" | "statsfm">(null)
  const [isGenerating, setIsGenerating] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState(false)

  const isConnected = lastfmUsername.trim().length > 0
  const isStatsfmConnected = statsfmUsername.trim().length > 0

  const familiarPct = Math.round((threshold / 50) * 100)
  const familiarBg = `linear-gradient(to right, var(--accent) ${familiarPct}%, rgba(255,255,255,0.10) ${familiarPct}%)`

  const familiarityLabel =
    threshold < 5  ? "Nothing familiar"
    : threshold < 15 ? "Mostly new"
    : threshold < 30 ? "Some favorites"
    : "All familiar"

  const familiarityHelp =
    threshold < 5
      ? "Almost nothing you\u2019ve heard before will appear."
      : threshold < 15
      ? "Mostly unfamiliar names with the occasional half-known artist."
      : threshold < 30
      ? "A balanced mix \u2014 some discovery, some comfort."
      : "Includes artists you already play often."

  // Popularity curve slider: store as 0.90–1.00 (k value).
  // Smaller k = steeper curve = stronger niche preference.
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
    } catch {
      setUndergroundMode(!next)
      toast.error("Failed to save setting")
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

  async function handleGenerate() {
    if (isGenerating) return
    setIsGenerating(true)
    try {
      const res = await fetch("/api/recommendations/generate?replace=true", { method: "POST" })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error((data as { error?: string }).error ?? "Generate failed")
      }
      router.push("/feed")
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't generate")
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

  return (
    <>
      {/* Slider CSS — shared by familiarity and popularity dials */}
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

      <div>
        {/* Page header */}
        <div className="page-head">
          <h1>Settings</h1>
          <span className="sub">no email · no password</span>
        </div>

        <div className="col gap-16" style={{ marginTop: 8 }}>

          {/* ── Profile ─────────────────────────────────────────────── */}
          <div>
            <div className="eyebrow" style={{ marginBottom: 10 }}>Profile</div>
            <div
              className="fs-card"
              style={{ display: "flex", alignItems: "center", gap: 14 }}
            >
              <IdenticonAvatar seed={userSeed} size={44} />
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 14, fontWeight: 700 }}>
                  your account
                </div>
                <div
                  style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 3, lineHeight: 1.45 }}
                >
                  your username is your only login — we store a hash, not the name itself
                </div>
              </div>
            </div>
          </div>

          {/* ── How familiar? ─────────────────────────────────────── */}
          <div>
            <div className="eyebrow" style={{ marginBottom: 10 }}>How familiar?</div>
            <div className="fs-card">
              <div
                style={{
                  display: "flex",
                  alignItems: "baseline",
                  justifyContent: "space-between",
                  marginBottom: 14,
                }}
              >
                <div className="serif" style={{ fontSize: 22, color: "var(--accent)" }}>
                  {familiarityLabel}
                </div>
                <div className="mono" style={{ fontSize: 12, color: "var(--text-muted)" }}>
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
                style={{ background: familiarBg }}
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
                <span>&larr; nothing familiar</span>
                <span>all familiar &rarr;</span>
              </div>
              <div className="muted" style={{ fontSize: 12, marginTop: 10, lineHeight: 1.5 }}>
                {familiarityHelp}
              </div>
            </div>
          </div>

          {/* ── Taste anchors ────────────────────────────────────────── */}
          <div>
            <div className="eyebrow" style={{ marginBottom: 10 }}>Taste anchors</div>
            <div
              className="fs-card col gap-14"
              style={{
                borderColor: "rgba(139,92,246,0.45)",
                borderWidth: 2,
                background: "rgba(139,92,246,0.04)",
              }}
            >
              <LibraryEditor
                initialGenreTags={initialSelectedGenres}
                initialSeedArtists={initialSeedArtists}
                flat
              />

              <div className="divider" />

              {/* Last.fm */}
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <div style={{ fontSize: 18, flexShrink: 0 }}>♫</div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 14, fontWeight: 600 }}>Last.fm</div>
                  <div
                    className="mono"
                    style={{
                      fontSize: 11,
                      color: isConnected ? "var(--like)" : "var(--text-muted)",
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
                <div style={{ fontSize: 18, flexShrink: 0 }}>📊</div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 14, fontWeight: 600 }}>stats.fm</div>
                  <div
                    className="mono"
                    style={{
                      fontSize: 11,
                      color: isStatsfmConnected ? "var(--like)" : "var(--text-muted)",
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

              <button
                className="btn btn-primary"
                onClick={handleGenerate}
                disabled={isGenerating}
                style={{ width: "100%", marginTop: 4 }}
              >
                {isGenerating ? "Generating…" : "Generate my feed →"}
              </button>
            </div>
          </div>

          {/* ── Discovery ────────────────────────────────────────────── */}
          <div>
            <div className="eyebrow" style={{ marginBottom: 10 }}>Discovery</div>
            <div className="fs-card col gap-16">
              {/* Popularity preference dial */}
              <div>
                <div
                  style={{
                    display: "flex",
                    alignItems: "baseline",
                    justifyContent: "space-between",
                    marginBottom: 14,
                  }}
                >
                  <div className="serif" style={{ fontSize: 22, color: "var(--accent)" }}>
                    {curveLabel}
                  </div>
                  <div className="mono" style={{ fontSize: 12, color: "var(--text-muted)" }}>
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

              <div className="divider" />

              {/* Live curve preview */}
              <CurvePreview
                popularityCurve={popularityCurve}
                undergroundMode={undergroundMode}
                exampleArtists={exampleArtists}
              />

              <div className="divider" />

              {/* Extra obscure toggle */}
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 16,
                }}
              >
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>
                    Extra obscure
                  </div>
                  <div className="muted" style={{ fontSize: 12, lineHeight: 1.5 }}>
                    Applies an extra penalty on top of the curve above. The dashed overlay shows the combined effect.
                  </div>
                </div>
                <button
                  onClick={handleUndergroundToggle}
                  role="switch"
                  aria-checked={undergroundMode}
                  style={{
                    width: 48,
                    height: 28,
                    borderRadius: 14,
                    border: 0,
                    cursor: "pointer",
                    flexShrink: 0,
                    background: undergroundMode ? "var(--accent)" : "rgba(255,255,255,0.10)",
                    position: "relative",
                    transition: "background 0.2s",
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
                      left: undergroundMode ? 23 : 3,
                      transition: "left 0.2s",
                    }}
                  />
                </button>
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
