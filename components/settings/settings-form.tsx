"use client"

import { useState } from "react"
import Image from "next/image"
import { toast } from "sonner"

interface SettingsFormProps {
  displayName: string | null
  avatarUrl: string | null
  initialPlayThreshold: number
  initialLastfmUsername: string | null
  initialLastfmArtistCount: number
  flipsidePlaylistId: string | null
}

/* ─── design tokens (inline, dark-only) ───────────────────────────── */
const card: React.CSSProperties = {
  background: "var(--bg-card)",
  border: "1px solid var(--border)",
  borderRadius: 12,
  padding: 16,
  marginBottom: 12,
}

const sectionLabel: React.CSSProperties = {
  fontSize: 9,
  fontWeight: 600,
  letterSpacing: "0.12em",
  textTransform: "uppercase",
  color: "var(--text-muted)",
  marginBottom: 12,
}

const fieldLabel: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 500,
  color: "var(--text-primary)",
  display: "block",
  marginBottom: 4,
}

const helperText: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 400,
  color: "var(--text-secondary)",
  marginTop: 4,
}

const inputStyle: React.CSSProperties = {
  background: "rgba(255,255,255,0.06)",
  border: "1px solid var(--border)",
  borderRadius: 8,
  color: "var(--text-primary)",
  fontSize: 13,
  padding: "7px 10px",
  outline: "none",
  width: "100%",
  maxWidth: 280,
  boxSizing: "border-box",
}

/* ─── helpers ─────────────────────────────────────────────────────── */
async function patchSettings(payload: Record<string, unknown>) {
  const res = await fetch("/api/settings", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  })
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error(data.error ?? "Failed to save")
  }
}

export function SettingsForm({
  displayName,
  avatarUrl,
  initialPlayThreshold,
  initialLastfmUsername,
  initialLastfmArtistCount,
  flipsidePlaylistId,
}: SettingsFormProps) {
  /* ── play threshold ─────────────────────────────────────────────── */
  const [threshold, setThreshold] = useState(initialPlayThreshold)

  async function handleThresholdRelease() {
    try {
      await patchSettings({ playThreshold: threshold })
    } catch {
      toast.error("Failed to save play threshold")
    }
  }

  /* ── last.fm ────────────────────────────────────────────────────── */
  const [lastfmUsername, setLastfmUsername] = useState(
    initialLastfmUsername ?? ""
  )
  const [lastfmCount, setLastfmCount] = useState(initialLastfmArtistCount)
  const [isSyncing, setIsSyncing] = useState(false)

  async function handleLastfmBlur() {
    const trimmed = lastfmUsername.trim()
    // Only save if value actually changed
    if (trimmed === (initialLastfmUsername ?? "")) return
    try {
      await patchSettings({ lastfmUsername: trimmed })
      toast.success("Last.fm username saved")
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to save Last.fm username"
      )
    }
  }

  async function handleSyncNow() {
    if (isSyncing) return
    setIsSyncing(true)
    try {
      const res = await fetch("/api/history/accumulate", { method: "POST" })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error ?? "Sync failed")
      }
      toast.success("Sync complete — refresh to see updated count")
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Sync failed"
      )
    } finally {
      setIsSyncing(false)
    }
  }

  /* ── last.fm status indicator ──────────────────────────────────── */
  const isConnected = lastfmUsername.trim().length > 0
  const syncStatus = isSyncing
    ? { label: "Syncing…", color: "var(--text-secondary)" }
    : isConnected
    ? {
        label: `Connected — ${lastfmCount} artist${lastfmCount !== 1 ? "s" : ""} synced`,
        color: "#4ade80",
      }
    : { label: "Not connected", color: "var(--text-muted)" }

  /* ── slider fill % ─────────────────────────────────────────────── */
  const sliderPct = Math.round((threshold / 50) * 100)
  const sliderBg = `linear-gradient(to right, var(--accent) ${sliderPct}%, rgba(255,255,255,0.10) ${sliderPct}%)`

  return (
    <>
      {/* Slider thumb / track CSS */}
      <style>{`
        .fs-slider {
          -webkit-appearance: none;
          appearance: none;
          width: 100%;
          max-width: 280px;
          height: 4px;
          border-radius: 2px;
          outline: none;
          cursor: pointer;
          background: ${sliderBg};
        }
        .fs-slider::-webkit-slider-thumb {
          -webkit-appearance: none;
          appearance: none;
          width: 16px;
          height: 16px;
          border-radius: 50%;
          background: var(--accent);
          border: none;
          cursor: pointer;
        }
        .fs-slider::-moz-range-thumb {
          width: 16px;
          height: 16px;
          border-radius: 50%;
          background: var(--accent);
          border: none;
          cursor: pointer;
        }
        .fs-slider:focus {
          box-shadow: 0 0 0 2px var(--accent-border);
        }
        .fs-input:focus {
          outline: none;
          border-color: var(--accent);
          box-shadow: 0 0 0 2px var(--accent-subtle);
        }
        .fs-btn {
          background: rgba(255,255,255,0.06);
          border: 1px solid var(--border);
          border-radius: 8px;
          color: var(--text-primary);
          font-size: 12px;
          font-weight: 500;
          padding: 6px 14px;
          cursor: pointer;
          transition: background 0.15s;
        }
        .fs-btn:hover:not(:disabled) {
          background: rgba(255,255,255,0.10);
        }
        .fs-btn:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }
        .fs-btn-destructive {
          background: transparent;
          border: 1px solid var(--border);
          color: var(--text-muted);
          font-size: 12px;
          font-weight: 500;
          padding: 6px 14px;
          cursor: pointer;
          border-radius: 8px;
          transition: color 0.15s, border-color 0.15s;
        }
        .fs-btn-destructive:hover {
          color: var(--text-secondary);
          border-color: rgba(255,255,255,0.15);
        }
      `}</style>

      <div style={{ display: "flex", flexDirection: "column" }}>

        {/* ── Profile ────────────────────────────────────────────────── */}
        <div>
          <p style={sectionLabel}>Profile</p>
          <div style={card}>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              {avatarUrl ? (
                <Image
                  src={avatarUrl}
                  alt={displayName ?? "User avatar"}
                  width={40}
                  height={40}
                  style={{ borderRadius: "50%", objectFit: "cover" }}
                />
              ) : (
                <div
                  style={{
                    width: 40,
                    height: 40,
                    borderRadius: "50%",
                    background: "rgba(255,255,255,0.08)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 16,
                    fontWeight: 600,
                    color: "var(--text-primary)",
                  }}
                >
                  {displayName?.[0]?.toUpperCase() ?? "?"}
                </div>
              )}
              <div>
                <p
                  style={{
                    fontSize: 13,
                    fontWeight: 500,
                    color: "var(--text-primary)",
                    margin: 0,
                  }}
                >
                  {displayName ?? "Spotify user"}
                </p>
                <p style={{ ...helperText, margin: 0, marginTop: 2 }}>
                  Synced from Spotify
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* ── Discovery ──────────────────────────────────────────────── */}
        <div>
          <p style={sectionLabel}>Discovery</p>
          <div style={card}>
            <label style={fieldLabel} htmlFor="play-threshold">
              Discovery threshold
              <span
                style={{
                  marginLeft: 10,
                  fontSize: 12,
                  fontWeight: 400,
                  color: "var(--text-secondary)",
                }}
              >
                {threshold} play{threshold !== 1 ? "s" : ""}
              </span>
            </label>
            <p style={helperText}>
              Artists you&apos;ve played more than this many times won&apos;t
              appear. Lower = more unfamiliar.
            </p>
            <div style={{ marginTop: 12 }}>
              <input
                id="play-threshold"
                type="range"
                className="fs-slider"
                min={0}
                max={50}
                step={1}
                value={threshold}
                onChange={(e) => setThreshold(Number(e.target.value))}
                onPointerUp={handleThresholdRelease}
                onKeyUp={handleThresholdRelease}
                style={{
                  background: sliderBg,
                }}
              />
            </div>
          </div>
        </div>

        {/* ── Last.fm ────────────────────────────────────────────────── */}
        <div>
          <p style={sectionLabel}>Last.fm</p>
          <div style={card}>
            <label style={fieldLabel} htmlFor="lastfm-username">
              Username
            </label>
            <input
              id="lastfm-username"
              type="text"
              className="fs-input"
              placeholder="your-lastfm-username"
              value={lastfmUsername}
              onChange={(e) => setLastfmUsername(e.target.value)}
              onBlur={handleLastfmBlur}
              style={inputStyle}
            />
            {/* Sync status row */}
            <div
              style={{
                marginTop: 10,
                display: "flex",
                alignItems: "center",
                gap: 10,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                {isConnected && !isSyncing && (
                  <span
                    style={{
                      width: 6,
                      height: 6,
                      borderRadius: "50%",
                      background: "#4ade80",
                      display: "inline-block",
                    }}
                  />
                )}
                <span
                  style={{
                    fontSize: 12,
                    color: syncStatus.color,
                  }}
                >
                  {syncStatus.label}
                </span>
              </div>
              <button
                className="fs-btn"
                onClick={handleSyncNow}
                disabled={isSyncing || !isConnected}
                style={{
                  background: "rgba(255,255,255,0.06)",
                  border: "1px solid var(--border)",
                  color: "var(--text-primary)",
                  fontSize: 12,
                  fontWeight: 500,
                  padding: "5px 12px",
                  cursor: isSyncing || !isConnected ? "not-allowed" : "pointer",
                  borderRadius: 8,
                  opacity: !isConnected ? 0.4 : 1,
                }}
              >
                {isSyncing ? "Syncing…" : "Sync now"}
              </button>
            </div>
          </div>
        </div>

        {/* ── Flipside playlist ──────────────────────────────────────── */}
        <div>
          <p style={sectionLabel}>Flipside Playlist</p>
          <div style={card}>
            {flipsidePlaylistId ? (
              <a
                href={`https://open.spotify.com/playlist/${flipsidePlaylistId}`}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  fontSize: 13,
                  color: "var(--accent)",
                  textDecoration: "none",
                }}
                onMouseOver={(e) =>
                  ((e.currentTarget as HTMLAnchorElement).style.textDecoration =
                    "underline")
                }
                onMouseOut={(e) =>
                  ((e.currentTarget as HTMLAnchorElement).style.textDecoration =
                    "none")
                }
              >
                Your Flipside Discoveries playlist
              </a>
            ) : (
              <p style={{ fontSize: 13, color: "var(--text-secondary)", margin: 0 }}>
                No playlist yet. Save an artist from your feed to create it
                automatically.
              </p>
            )}
          </div>
        </div>

        {/* ── Account ────────────────────────────────────────────────── */}
        <div>
          <p style={sectionLabel}>Account</p>
          <div style={card}>
            <form action="/api/auth/signout" method="POST">
              <button type="submit" className="fs-btn-destructive">
                Sign out
              </button>
            </form>
          </div>
        </div>

      </div>
    </>
  )
}
