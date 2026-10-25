"use client"

import { useState, useMemo, useRef, useSyncExternalStore } from "react"
import Image from "next/image"
import { ThumbsUp, ThumbsDown, SkipForward, Bookmark, Undo2 } from "lucide-react"
import { hexToRgba, resolveArtistColor } from "@/lib/color-utils"
import { useArtistFeedback } from "@/lib/hooks/use-artist-feedback"

interface HistoryEntry {
  artist_id: string
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

const noopSubscribe = () => () => {}

/**
 * False on the server and during hydration, true after. timeAgo() reads the
 * clock and local timezone, so rendering it on the server (UTC) mismatches the
 * client on every load; it renders only once mounted.
 */
function useMounted(): boolean {
  return useSyncExternalStore(noopSubscribe, () => true, () => false)
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
  // Server-side fetch offset, independent of `history.length`: undo removes
  // rows client-side without shrinking the server's row count (feedback
  // delete leaves recommendation_cache.seen_at set), so paginating off
  // history.length re-fetches an already-seen boundary row and produces a
  // duplicate React key + duplicate visible row. Track what we've actually
  // pulled from the server instead.
  const fetchedCountRef = useRef(initialHistory.length)
  const mounted = useMounted()

  // Signal changes (thumbs up/down) and undo go through the shared artist-
  // signal controller so rapid taps on the same artist (e.g. "Change to Liked"
  // immediately followed by "Undo") are serialized in click order. A row shows
  // the controller's (optimistic, rolled-back-on-failure) signal when it has
  // one, else the signal the row was loaded with. Undo/unblock are confirmed
  // ops: the row stays until the server confirms, then drops out.
  const { signals, setSignal, removeSignal, dismiss } = useArtistFeedback({
    errorMessages: {
      // undoFailed default ("Couldn't undo — try again") already matches
      // this page's copy for both undo paths below.
      saveFailed: "Couldn't update signal — try again",
    },
  })

  // Rows as displayed: the controller's signal overrides the loaded one.
  const shown = useMemo(
    () =>
      history.map((h) => {
        const sig = signals.get(h.artist_id)
        return sig === undefined || sig === h.signal ? h : { ...h, signal: sig }
      }),
    [history, signals],
  )

  const filtered = useMemo(() => {
    if (filter === "all") return shown
    if (filter === "bookmarked") return shown.filter((h) => h.bookmarked)
    return shown.filter((h) => h.signal === filter && !h.bookmarked)
  }, [shown, filter])

  const counts = useMemo(() => {
    const c: Record<FilterTab, number> = { all: shown.length, thumbs_up: 0, thumbs_down: 0, skip: 0, dismissed: 0, bookmarked: 0 }
    for (const h of shown) {
      if (h.bookmarked) c.bookmarked++
      else if (h.signal === "thumbs_up") c.thumbs_up++
      else if (h.signal === "thumbs_down") c.thumbs_down++
      else if (h.signal === "dismissed") c.dismissed++
      else c.skip++
    }
    return c
  }, [shown])

  const groups = useMemo(() => groupByPeriod(filtered), [filtered])

  async function handleUndo(artistId: string, signal: string) {
    setUndoingIds((prev) => new Set(prev).add(artistId))
    try {
      // Dismissed items have no feedback row (the skip RPC only stamps
      // recommendation_cache.skip_at): unblocking wipes skip_at + seen_at via
      // /api/dismiss so the artist is fully eligible again.
      const ok = signal === "dismissed" ? await dismiss(artistId) : await removeSignal(artistId)
      if (ok) setHistory((prev) => prev.filter((h) => h.artist_id !== artistId))
    } finally {
      setUndoingIds((prev) => {
        const next = new Set(prev)
        next.delete(artistId)
        return next
      })
    }
  }

  function handleChangeSignal(artistId: string, newSignal: string) {
    void setSignal(artistId, newSignal)
  }

  async function handleLoadMore() {
    setIsLoadingMore(true)
    try {
      const res = await fetch(`/api/history?offset=${fetchedCountRef.current}&limit=50`)
      if (!res.ok) throw new Error("Server error")
      const data = await res.json()
      if (data.history?.length) {
        fetchedCountRef.current += data.history.length
        setHistory((prev) => {
          const seenIds = new Set(prev.map((h) => h.artist_id))
          const deduped = (data.history as HistoryEntry[]).filter((h) => !seenIds.has(h.artist_id))
          return [...prev, ...deduped]
        })
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
                  const artistColor = resolveArtistColor(entry.artist_color, entry.artist_data.name)
                  const sig = entry.bookmarked
                    ? SIG_STYLES.bookmarked
                    : (SIG_STYLES[entry.signal] ?? SIG_STYLES.skip)
                  const { Icon } = sig
                  const isUndoing = undoingIds.has(entry.artist_id)

                  return (
                    <div
                      key={entry.artist_id}
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
                          {/* nbsp keeps the line's height until the client-only time renders */}
                          {mounted ? timeAgo(entry.seen_at) : "\u00a0"}
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
                            onClick={() => handleChangeSignal(entry.artist_id, "thumbs_up")}
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
                            onClick={() => handleChangeSignal(entry.artist_id, "thumbs_down")}
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
                          onClick={() => handleUndo(entry.artist_id, entry.signal)}
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
