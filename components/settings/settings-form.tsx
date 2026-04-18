"use client"

import { useState } from "react"
import { signOut } from "next-auth/react"
import { toast } from "sonner"
import { IdenticonAvatar } from "@/components/ui/identicon-avatar"

interface SettingsFormProps {
  userSeed: string
  initialPlayThreshold: number
  initialLastfmUsername: string | null
  initialLastfmArtistCount: number
  initialUndergroundMode: boolean
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
  initialLastfmUsername,
  initialLastfmArtistCount,
  initialUndergroundMode,
}: SettingsFormProps) {
  const [threshold, setThreshold] = useState(initialPlayThreshold)
  const [lastfmUsername, setLastfmUsername] = useState(initialLastfmUsername ?? "")
  const [undergroundMode, setUndergroundMode] = useState(initialUndergroundMode)
  const [isSyncing, setIsSyncing] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState(false)

  const isConnected = lastfmUsername.trim().length > 0

  const sliderPct = Math.round((threshold / 50) * 100)
  const sliderBg = `linear-gradient(to right, var(--accent) ${sliderPct}%, rgba(255,255,255,0.10) ${sliderPct}%)`

  const obscurityLabel =
    threshold < 5  ? "Deep underground"
    : threshold < 15 ? "Adventurous"
    : threshold < 30 ? "Curious"
    : "Familiar"

  const obscurityHelp =
    threshold < 5
      ? "Almost nothing you\u2019ve heard before will appear."
      : threshold < 15
      ? "Mostly unfamiliar names with the occasional half-known artist."
      : threshold < 30
      ? "A balanced mix \u2014 some discovery, some comfort."
      : "Includes artists you already play often."

  async function handleThresholdRelease() {
    try {
      await patchSettings({ playThreshold: threshold })
    } catch {
      toast.error("Failed to save play threshold")
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

  async function handleSyncNow() {
    if (isSyncing || !isConnected) return
    setIsSyncing(true)
    try {
      const res = await fetch("/api/history/accumulate", { method: "POST" })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error((data as { error?: string }).error ?? "Sync failed")
      }
      toast.success("Sync complete")
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Sync failed")
    } finally {
      setIsSyncing(false)
    }
  }

  return (
    <>
      {/* Slider CSS */}
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
                  className="mono"
                  style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}
                >
                  zero PII stored
                </div>
              </div>
            </div>
          </div>

          {/* ── How underground? ─────────────────────────────────────── */}
          <div>
            <div className="eyebrow" style={{ marginBottom: 10 }}>How underground?</div>
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
                  {obscurityLabel}
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
                style={{ background: sliderBg }}
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
                {obscurityHelp}
              </div>
            </div>
          </div>

          {/* ── Deep underground mode ──────────────────────────────── */}
          <div>
            <div className="eyebrow" style={{ marginBottom: 10 }}>Deep underground mode</div>
            <div className="fs-card">
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
                    Aggressively deprioritize anything remotely popular. Only for listeners who want the absolute deepest cuts.
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

          {/* ── Connected sources ────────────────────────────────────── */}
          <div>
            <div className="eyebrow" style={{ marginBottom: 10 }}>Connected sources</div>
            <div className="fs-card col gap-12">
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
                  onClick={handleSyncNow}
                  disabled={isSyncing || !isConnected}
                  style={{ flexShrink: 0, opacity: !isConnected ? 0.4 : 1 }}
                >
                  {isSyncing ? "Syncing…" : "Sync now"}
                </button>
              </div>

              <div className="divider" />

              {/* Spotify — restricted */}
              <div style={{ display: "flex", alignItems: "center", gap: 12, opacity: 0.55 }}>
                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="var(--spotify)"
                  style={{ flexShrink: 0 }}
                >
                  <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z"/>
                </svg>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 14, fontWeight: 600 }}>Spotify</div>
                  <div className="mono" style={{ fontSize: 11, color: "var(--text-muted)" }}>
                    restricted access
                  </div>
                </div>
                <span
                  style={{
                    fontSize: 9.5,
                    fontWeight: 700,
                    padding: "2px 7px",
                    borderRadius: 4,
                    background: "rgba(255,255,255,0.06)",
                    color: "var(--text-muted)",
                    letterSpacing: "0.08em",
                    textTransform: "uppercase",
                  }}
                >
                  locked
                </span>
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
