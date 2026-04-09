"use client"

import { useState, useMemo } from "react"
import { useRouter } from "next/navigation"
import { ThumbsUp, ThumbsDown, Clock, Bookmark, Undo2, ExternalLink } from "lucide-react"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

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
  signal: string     // "thumbs_up" | "thumbs_down" | "skip"
  bookmarked: boolean
}

type FilterTab = "all" | "thumbs_up" | "thumbs_down" | "skip" | "bookmarked"

interface HistoryClientProps {
  history: HistoryEntry[]
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function hexToRgba(hex: string, alpha: number): string {
  const cleaned = hex.replace(/^#/, "")
  const full = cleaned.length === 3 ? cleaned.split("").map((c) => c + c).join("") : cleaned
  const num = parseInt(full.slice(0, 6), 16)
  return `rgba(${(num >> 16) & 0xff}, ${(num >> 8) & 0xff}, ${num & 0xff}, ${alpha})`
}

function signalMeta(signal: string, bookmarked: boolean) {
  if (bookmarked) return { label: "Bookmarked", emoji: "🔖", color: "#a78bfa", bg: "rgba(167,139,250,0.12)", border: "rgba(167,139,250,0.25)" }
  switch (signal) {
    case "thumbs_up":   return { label: "Liked",    emoji: "👍", color: "#22c55e", bg: "rgba(34,197,94,0.12)",  border: "rgba(34,197,94,0.25)" }
    case "thumbs_down": return { label: "Disliked", emoji: "👎", color: "#ff4b4b", bg: "rgba(255,75,75,0.12)", border: "rgba(255,75,75,0.25)" }
    default:            return { label: "Skipped",  emoji: "⏱️", color: "#888",    bg: "rgba(255,255,255,0.05)", border: "rgba(255,255,255,0.1)" }
  }
}

function timeAgo(dateStr: string): string {
  const seconds = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000)
  if (seconds < 60) return "just now"
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

const FILTER_TABS: { key: FilterTab; label: string; icon: React.ElementType }[] = [
  { key: "all",         label: "All",        icon: Clock },
  { key: "thumbs_up",   label: "Liked",      icon: ThumbsUp },
  { key: "thumbs_down", label: "Disliked",   icon: ThumbsDown },
  { key: "skip",        label: "Skipped",    icon: Clock },
  { key: "bookmarked",  label: "Bookmarked", icon: Bookmark },
]

export function HistoryClient({ history: initialHistory }: HistoryClientProps) {
  const router = useRouter()
  const [history, setHistory] = useState(initialHistory)
  const [filter, setFilter] = useState<FilterTab>("all")
  const [undoingIds, setUndoingIds] = useState<Set<string>>(new Set())

  const filtered = useMemo(() => {
    if (filter === "all") return history
    if (filter === "bookmarked") return history.filter((h) => h.bookmarked)
    return history.filter((h) => h.signal === filter && !h.bookmarked)
  }, [history, filter])

  // Counts for the filter badges
  const counts = useMemo(() => {
    const c = { all: history.length, thumbs_up: 0, thumbs_down: 0, skip: 0, bookmarked: 0 }
    for (const h of history) {
      if (h.bookmarked) c.bookmarked++
      else if (h.signal === "thumbs_up") c.thumbs_up++
      else if (h.signal === "thumbs_down") c.thumbs_down++
      else c.skip++
    }
    return c
  }, [history])

  async function handleUndo(artistId: string) {
    setUndoingIds((prev) => new Set(prev).add(artistId))
    try {
      // 1. Delete the feedback row (soft-delete + clear seen_at)
      await fetch(`/api/feedback/${artistId}`, { method: "DELETE" })
      // 2. Remove from local state
      setHistory((prev) => prev.filter((h) => h.spotify_artist_id !== artistId))
    } catch (err) {
      console.error("[history] undo failed", err)
    } finally {
      setUndoingIds((prev) => {
        const next = new Set(prev)
        next.delete(artistId)
        return next
      })
    }
  }

  async function handleChangeSignal(artistId: string, newSignal: string) {
    // Optimistic update
    setHistory((prev) =>
      prev.map((h) =>
        h.spotify_artist_id === artistId ? { ...h, signal: newSignal } : h
      )
    )
    try {
      await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ spotifyArtistId: artistId, signal: newSignal }),
      })
    } catch (err) {
      console.error("[history] signal change failed", err)
    }
  }

  return (
    <div className="relative min-h-screen w-full flex flex-col items-center pt-6 pb-[200px]">
      {/* Header */}
      <div className="w-full max-w-[600px] px-4 mb-6">
        <h1 className="text-2xl font-bold text-white mb-1">History</h1>
        <p className="text-sm text-gray-400">
          Every artist you&apos;ve been recommended. Change your mind anytime.
        </p>
      </div>

      {/* Filter Tabs */}
      <div className="w-full max-w-[600px] px-4 mb-6">
        <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-hide">
          {FILTER_TABS.map(({ key, label, icon: Icon }) => {
            const active = filter === key
            const count = counts[key]
            return (
              <button
                key={key}
                onClick={() => setFilter(key)}
                className={`flex items-center gap-1.5 px-4 h-9 rounded-full text-[13px] font-semibold whitespace-nowrap transition-all border cursor-pointer ${
                  active
                    ? "bg-white/10 border-white/20 text-white"
                    : "bg-white/[0.03] border-white/[0.06] text-gray-500 hover:text-gray-300 hover:bg-white/[0.06]"
                }`}
              >
                <Icon className="size-3.5" />
                {label}
                {count > 0 && (
                  <span className={`ml-0.5 text-[11px] ${active ? "text-gray-300" : "text-gray-600"}`}>
                    {count}
                  </span>
                )}
              </button>
            )
          })}
        </div>
      </div>

      {/* History List */}
      <div className="w-full max-w-[600px] px-4 flex flex-col gap-3">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <Clock className="size-10 text-gray-600 mb-3" />
            <p className="text-sm font-medium text-gray-400">
              {filter === "all"
                ? "No history yet. Start discovering artists in your feed!"
                : `No ${FILTER_TABS.find((t) => t.key === filter)?.label.toLowerCase()} artists yet.`}
            </p>
          </div>
        ) : (
          filtered.map((entry) => {
            const meta = signalMeta(entry.signal, entry.bookmarked)
            const artistColor = entry.artist_color ?? "#8b5cf6"
            const isUndoing = undoingIds.has(entry.spotify_artist_id)

            return (
              <div
                key={entry.spotify_artist_id}
                className="group relative flex items-center gap-3 p-3 rounded-2xl border transition-all hover:bg-white/[0.03]"
                style={{
                  background: "rgba(15,15,15,0.5)",
                  backdropFilter: "blur(12px)",
                  border: `1px solid rgba(255,255,255,0.06)`,
                }}
              >
                {/* Artist Image */}
                <div className="relative shrink-0 size-14 rounded-xl overflow-hidden">
                  {entry.artist_data.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={entry.artist_data.imageUrl}
                      alt={entry.artist_data.name}
                      className="size-full object-cover"
                    />
                  ) : (
                    <div
                      className="size-full flex items-center justify-center text-lg font-bold"
                      style={{ background: hexToRgba(artistColor, 0.2), color: artistColor }}
                    >
                      {entry.artist_data.name.charAt(0)}
                    </div>
                  )}
                  {/* Tiny color accent bar */}
                  <div
                    className="absolute bottom-0 inset-x-0 h-[3px]"
                    style={{ background: artistColor }}
                  />
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-[15px] font-semibold text-white truncate">
                      {entry.artist_data.name}
                    </span>
                    <a
                      href={`https://open.spotify.com/artist/${entry.spotify_artist_id}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="shrink-0 text-gray-600 hover:text-gray-400 transition-colors"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <ExternalLink className="size-3.5" />
                    </a>
                  </div>
                  <div className="flex items-center gap-2 mt-0.5">
                    {/* Signal badge */}
                    <span
                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold"
                      style={{ background: meta.bg, border: `1px solid ${meta.border}`, color: meta.color }}
                    >
                      {meta.emoji} {meta.label}
                    </span>
                    <span className="text-[11px] text-gray-600">{timeAgo(entry.seen_at)}</span>
                  </div>
                  {entry.artist_data.genres.length > 0 && (
                    <p className="text-[11px] text-gray-500 mt-0.5 truncate">
                      {entry.artist_data.genres.slice(0, 2).join(" · ")}
                    </p>
                  )}
                </div>

                {/* Actions */}
                <div className="flex shrink-0 items-center gap-1">
                  {/* Quick signal toggles */}
                  {entry.signal !== "thumbs_up" && (
                    <button
                      onClick={() => handleChangeSignal(entry.spotify_artist_id, "thumbs_up")}
                      className="size-9 flex items-center justify-center rounded-xl text-gray-600 hover:text-[#22c55e] hover:bg-[#22c55e]/10 transition-colors cursor-pointer"
                      title="Change to Like"
                    >
                      <ThumbsUp className="size-4" />
                    </button>
                  )}
                  {entry.signal !== "thumbs_down" && (
                    <button
                      onClick={() => handleChangeSignal(entry.spotify_artist_id, "thumbs_down")}
                      className="size-9 flex items-center justify-center rounded-xl text-gray-600 hover:text-[#ff4b4b] hover:bg-[#ff4b4b]/10 transition-colors cursor-pointer"
                      title="Change to Dislike"
                    >
                      <ThumbsDown className="size-4" />
                    </button>
                  )}

                  {/* Undo — sends back to feed */}
                  <button
                    onClick={() => handleUndo(entry.spotify_artist_id)}
                    disabled={isUndoing}
                    className="size-9 flex items-center justify-center rounded-xl text-gray-600 hover:text-white hover:bg-white/10 transition-colors cursor-pointer disabled:opacity-40"
                    title="Undo — return to feed"
                  >
                    {isUndoing ? (
                      <div className="w-3.5 h-3.5 border-2 border-gray-600 border-t-white rounded-full animate-spin" />
                    ) : (
                      <Undo2 className="size-4" />
                    )}
                  </button>
                </div>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
