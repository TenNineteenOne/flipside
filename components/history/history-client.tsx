"use client"

import { useState, useMemo } from "react"
import Image from "next/image"
import { toast } from "sonner"
import { ThumbsUp, ThumbsDown, SkipForward, Bookmark, Undo2 } from "lucide-react"
import { stringToVibrantHex, hexToRgba, sanitizeHex } from "@/lib/color-utils"

interface HistoryEntry {
  spotify_artist_id: string
  artist_data: {
    id: string
    name: string
    genres: string[]
    imageUrl: string | null
    popularity: number
  }
  score: number
  why: { sourceArtists: string[]; genres: string[]; friendBoost: string[] }
  artist_color?: string | null
  seen_at: string
  signal: string
  bookmarked: boolean
}

type FilterTab = "all" | "thumbs_up" | "thumbs_down" | "skip" | "dismissed" | "bookmarked"

interface HistoryClientProps {
  history: HistoryEntry[]
  hasMore?: boolean
}

const SIG_STYLES: Record<string, { Icon: React.ElementType; color: string; label: string }> = {
  thumbs_up:   { Icon: ThumbsUp,    color: "var(--like)",       label: "Liked"     },
  thumbs_down: { Icon: ThumbsDown,  color: "var(--dislike)",    label: "Passed"    },
  skip:        { Icon: SkipForward, color: "var(--text-muted)", label: "Skipped"   },
  dismissed:   { Icon: SkipForward, color: "var(--text-faint)", label: "Dismissed" },
  bookmarked:  { Icon: Bookmark,    color: "var(--accent)",     label: "Saved"     },
}

function timeAgo(dateStr: string): string {
  const seconds = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000)
  if (seconds < 60) return "just now"
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d ago`
  return new Date(dateStr).toLocaleDateString("en-US", { month: "short", day: "numeric" })
}

function groupByPeriod(entries: HistoryEntry[]) {
  const now = Date.now()
  const today: HistoryEntry[] = []
  const yesterday: HistoryEntry[] = []
  const thisWeek: HistoryEntry[] = []
  const older: HistoryEntry[] = []

  for (const e of entries) {
    const age = now - new Date(e.seen_at).getTime()
    const hours = age / 3600000
    if (hours < 24) today.push(e)
    else if (hours < 48) yesterday.push(e)
    else if (hours < 168) thisWeek.push(e)
    else older.push(e)
  }

  const groups: { label: string; items: HistoryEntry[] }[] = []
  if (today.length) groups.push({ label: "Today", items: today })
  if (yesterday.length) groups.push({ label: "Yesterday", items: yesterday })
  if (thisWeek.length) groups.push({ label: "Earlier this week", items: thisWeek })
  if (older.length) groups.push({ label: "Older", items: older })
  return groups
}

// ---------------------------------------------------------------------------
// Filter tabs
// ---------------------------------------------------------------------------

const FILTER_TABS: { key: FilterTab; label: string }[] = [
  { key: "all",         label: "All"       },
  { key: "thumbs_up",   label: "Liked"     },
  { key: "thumbs_down", label: "Passed"    },
  { key: "skip",        label: "Skipped"   },
  { key: "dismissed",   label: "Dismissed" },
  { key: "bookmarked",  label: "Saved"     },
]

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function HistoryClient({ history: initialHistory, hasMore: initialHasMore = false }: HistoryClientProps) {
  const [history, setHistory] = useState(initialHistory)
  const [filter, setFilter] = useState<FilterTab>("all")
  const [undoingIds, setUndoingIds] = useState<Set<string>>(new Set())
  const [hasMore, setHasMore] = useState(initialHasMore)
  const [isLoadingMore, setIsLoadingMore] = useState(false)

  const filtered = useMemo(() => {
    if (filter === "all") return history
    if (filter === "bookmarked") return history.filter((h) => h.bookmarked)
    return history.filter((h) => h.signal === filter && !h.bookmarked)
  }, [history, filter])

  const counts = useMemo(() => {
    const c: Record<FilterTab, number> = { all: history.length, thumbs_up: 0, thumbs_down: 0, skip: 0, dismissed: 0, bookmarked: 0 }
    for (const h of history) {
      if (h.bookmarked) c.bookmarked++
      else if (h.signal === "thumbs_up") c.thumbs_up++
      else if (h.signal === "thumbs_down") c.thumbs_down++
      else if (h.signal === "dismissed") c.dismissed++
      else c.skip++
    }
    return c
  }, [history])

  const groups = useMemo(() => groupByPeriod(filtered), [filtered])

  async function handleUndo(artistId: string, signal: string) {
    setUndoingIds((prev) => new Set(prev).add(artistId))
    // Dismissed items have no feedback row (the skip RPC only stamps
    // recommendation_cache.skip_at). Clearing requires a separate endpoint
    // that wipes skip_at + seen_at so the artist is fully eligible again.
    const endpoint = signal === "dismissed"
      ? `/api/dismiss/${artistId}`
      : `/api/feedback/${artistId}`
    try {
      const res = await fetch(endpoint, { method: "DELETE" })
      if (!res.ok) throw new Error("Server error")
      setHistory((prev) => prev.filter((h) => h.spotify_artist_id !== artistId))
    } catch {
      toast.error("Couldn't undo — try again")
    } finally {
      setUndoingIds((prev) => {
        const next = new Set(prev)
        next.delete(artistId)
        return next
      })
    }
  }

  async function handleChangeSignal(artistId: string, newSignal: string) {
    const prevSignal = history.find((h) => h.spotify_artist_id === artistId)?.signal
    setHistory((prev) =>
      prev.map((h) => (h.spotify_artist_id === artistId ? { ...h, signal: newSignal } : h))
    )
    try {
      const res = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ spotifyArtistId: artistId, signal: newSignal }),
      })
      if (!res.ok) throw new Error("Server error")
    } catch {
      setHistory((prev) =>
        prev.map((h) => (h.spotify_artist_id === artistId ? { ...h, signal: prevSignal ?? "skip" } : h))
      )
      toast.error("Couldn't update signal — try again")
    }
  }

  async function handleLoadMore() {
    setIsLoadingMore(true)
    try {
      const res = await fetch(`/api/history?offset=${history.length}&limit=50`)
      if (!res.ok) throw new Error("Server error")
      const data = await res.json()
      if (data.history?.length) {
        setHistory((prev) => [...prev, ...data.history])
        setHasMore(data.hasMore ?? false)
      } else {
        setHasMore(false)
      }
    } catch (err) {
      console.error("[history] load more failed", err)
    } finally {
      setIsLoadingMore(false)
    }
  }

  return (
    <div>
      {/* Page header */}
      <div className="page-head">
        <h1>History</h1>
        <span className="sub">your taps &amp; skips</span>
      </div>

      {/* Filter chips */}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 20 }}>
        {FILTER_TABS.map(({ key, label }) => {
          const active = filter === key
          const count = counts[key]
          return (
            <button
              key={key}
              onClick={() => setFilter(key)}
              className={"chip" + (active ? " selected" : "")}
            >
              {label}
              {count > 0 && (
                <span
                  className="mono"
                  style={{ fontSize: 10, color: active ? "var(--text-primary)" : "var(--text-faint)" }}
                >
                  {count}
                </span>
              )}
            </button>
          )
        })}
      </div>

      {/* Groups */}
      {groups.length === 0 ? (
        <div
          style={{
            textAlign: "center",
            padding: "80px 20px",
            color: "var(--text-muted)",
          }}
        >
          <SkipForward
            size={32}
            style={{ margin: "0 auto 12px", display: "block", opacity: 0.4 }}
          />
          <div style={{ fontSize: 14 }}>
            {filter === "all"
              ? "No history yet. Start discovering artists in your feed."
              : `No ${FILTER_TABS.find((t) => t.key === filter)?.label.toLowerCase()} artists yet.`}
          </div>
        </div>
      ) : (
        <div className="col gap-24" style={{ marginTop: 8 }}>
          {groups.map(({ label, items }) => (
            <div key={label}>
              <div className="eyebrow" style={{ marginBottom: 10 }}>{label}</div>
              <div
                style={{
                  background: "var(--bg-card)",
                  border: "1px solid var(--border)",
                  borderRadius: 16,
                  overflow: "hidden",
                }}
              >
                {items.map((entry, i) => {
                  const artistColor = sanitizeHex(entry.artist_color) === "#8b5cf6" ? stringToVibrantHex(entry.artist_data.name) : sanitizeHex(entry.artist_color)
                  const sig = entry.bookmarked
                    ? SIG_STYLES.bookmarked
                    : (SIG_STYLES[entry.signal] ?? SIG_STYLES.skip)
                  const { Icon } = sig
                  const isUndoing = undoingIds.has(entry.spotify_artist_id)

                  return (
                    <div
                      key={entry.spotify_artist_id}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 14,
                        padding: "12px 16px",
                        borderTop: i === 0 ? 0 : "1px solid var(--border)",
                      }}
                    >
                      {/* 36px art square */}
                      <div
                        style={{
                          width: 36,
                          height: 36,
                          borderRadius: 10,
                          overflow: "hidden",
                          flexShrink: 0,
                          background: hexToRgba(artistColor, 0.2),
                        }}
                      >
                        {entry.artist_data.imageUrl ? (
                          <Image
                            src={entry.artist_data.imageUrl}
                            alt={entry.artist_data.name}
                            width={36}
                            height={36}
                            style={{ width: "100%", height: "100%", objectFit: "cover" }}
                            unoptimized
                          />
                        ) : null}
                      </div>

                      {/* Name + time */}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 14, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                          {entry.artist_data.name}
                        </div>
                        <div className="mono" style={{ fontSize: 11, color: "var(--text-muted)" }}>
                          {timeAgo(entry.seen_at)}
                          {entry.artist_data.popularity > 0 && ` · popularity ${entry.artist_data.popularity}`}
                        </div>
                      </div>

                      {/* Signal label — no emoji */}
                      <div style={{ display: "flex", alignItems: "center", gap: 6, color: sig.color, flexShrink: 0 }}>
                        <Icon size={14} />
                        <span style={{ fontSize: 12, fontWeight: 600 }}>{sig.label}</span>
                      </div>

                      {/* Quick actions */}
                      <div style={{ display: "flex", alignItems: "center", gap: 2, flexShrink: 0 }}>
                        {entry.signal !== "thumbs_up" && entry.signal !== "dismissed" && !entry.bookmarked && (
                          <button
                            onClick={() => handleChangeSignal(entry.spotify_artist_id, "thumbs_up")}
                            title="Change to Liked"
                            style={{
                              width: 32, height: 32, borderRadius: 8,
                              background: "transparent", border: 0, cursor: "pointer",
                              color: "var(--text-faint)", display: "grid", placeItems: "center",
                            }}
                          >
                            <ThumbsUp size={13} />
                          </button>
                        )}
                        {entry.signal !== "thumbs_down" && entry.signal !== "dismissed" && !entry.bookmarked && (
                          <button
                            onClick={() => handleChangeSignal(entry.spotify_artist_id, "thumbs_down")}
                            title="Change to Passed"
                            style={{
                              width: 32, height: 32, borderRadius: 8,
                              background: "transparent", border: 0, cursor: "pointer",
                              color: "var(--text-faint)", display: "grid", placeItems: "center",
                            }}
                          >
                            <ThumbsDown size={13} />
                          </button>
                        )}
                        <button
                          onClick={() => handleUndo(entry.spotify_artist_id, entry.signal)}
                          disabled={isUndoing}
                          title={entry.signal === "dismissed" ? "Unblock — allow in feed again" : "Undo — return to feed"}
                          style={{
                            width: 32, height: 32, borderRadius: 8,
                            background: "transparent", border: 0, cursor: "pointer",
                            color: "var(--text-faint)", display: "grid", placeItems: "center",
                            opacity: isUndoing ? 0.4 : 1,
                          }}
                        >
                          <Undo2 size={13} />
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          ))}
          {hasMore && (
            <div style={{ display: "flex", justifyContent: "center", padding: "16px 0" }}>
              <button className="btn" onClick={handleLoadMore} disabled={isLoadingMore}>
                {isLoadingMore ? "Loading…" : "Load more"}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
