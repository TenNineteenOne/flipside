"use client"

import { useState } from "react"
import { toast } from "sonner"
import { hexToRgba } from "@/lib/color-utils"
import { patchSettings } from "@/lib/settings/patch-settings"
import { MINT, LASTFM_RED, STATSFM_PURPLE } from "@/lib/settings/obscurity"

interface ConnectedSourcesPanelProps {
  initialLastfmUsername: string | null
  initialStatsfmUsername: string | null
  initialLastfmArtistCount: number
}

export function ConnectedSourcesPanel({
  initialLastfmUsername,
  initialStatsfmUsername,
  initialLastfmArtistCount,
}: ConnectedSourcesPanelProps) {
  const [lastfmUsername, setLastfmUsername] = useState(initialLastfmUsername ?? "")
  const [statsfmUsername, setStatsfmUsername] = useState(initialStatsfmUsername ?? "")
  const [syncingSource, setSyncingSource] = useState<null | "lastfm" | "statsfm">(null)

  const isConnected = lastfmUsername.trim().length > 0
  const isStatsfmConnected = statsfmUsername.trim().length > 0

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
          <div style={{ flex: 1, minWidth: 0 }}>
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
          <div style={{ flex: 1, minWidth: 0 }}>
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
  )
}
