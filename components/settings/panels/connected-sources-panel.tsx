"use client"

import { useState } from "react"
import { toast } from "sonner"
import { hexToRgba } from "@/lib/color-utils"
import { patchSettings } from "@/lib/settings/patch-settings"
import { MINT, LASTFM_RED, STATSFM_PURPLE } from "@/lib/settings/obscurity"

/**
 * One source username field: `draft` is the input, `saved` the last value the
 * server accepted. Blur saves when the draft differs from `saved` (not from
 * the initial prop — bob→alice→bob must save the second bob); a rejected
 * save leaves `saved` alone.
 */
function useSourceUsername(
  initial: string | null,
  key: "lastfmUsername" | "statsfmUsername",
  label: string,
) {
  const [draft, setDraft] = useState(initial ?? "")
  const [saved, setSaved] = useState(initial ?? "")

  async function onBlur() {
    const trimmed = draft.trim()
    if (trimmed === saved) return
    try {
      await patchSettings({ [key]: trimmed })
      setSaved(trimmed)
      toast.success(`${label} username saved`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : `Failed to save ${label} username`)
    }
  }

  return { draft, setDraft, saved, onBlur }
}

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
  const lastfm = useSourceUsername(initialLastfmUsername, "lastfmUsername", "Last.fm")
  const statsfm = useSourceUsername(initialStatsfmUsername, "statsfmUsername", "stats.fm")
  const [syncingSource, setSyncingSource] = useState<null | "lastfm" | "statsfm">(null)

  // Status + Sync reflect what the server has, not an unsaved/rejected draft.
  const isConnected = lastfm.saved.length > 0
  const isStatsfmConnected = statsfm.saved.length > 0

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
                ? `connected · @${lastfm.saved}${lastfm.saved === (initialLastfmUsername ?? "") ? ` · ${initialLastfmArtistCount} artists` : ""}`
                : "not connected"}
            </div>
            <div className="field" style={{ height: 40, marginTop: 8 }}>
              <input
                type="text"
                placeholder="your-lastfm-username"
                value={lastfm.draft}
                onChange={(e) => lastfm.setDraft(e.target.value)}
                onBlur={lastfm.onBlur}
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
                ? `connected · @${statsfm.saved}`
                : "not connected"}
            </div>
            <div className="field" style={{ height: 40, marginTop: 8 }}>
              <input
                type="text"
                placeholder="your-statsfm-username"
                value={statsfm.draft}
                onChange={(e) => statsfm.setDraft(e.target.value)}
                onBlur={statsfm.onBlur}
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
