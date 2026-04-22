"use client"

import { useState, useMemo } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { ArtistCard } from "@/components/feed/artist-card"
import { hexToRgba, sanitizeHex } from "@/lib/color-utils"
import { normalizedIncludes } from "@/lib/genre/normalize"
import type { MusicPlatform } from "@/lib/music-links"

interface Track {
  id: string
  spotifyTrackId: string | null
  name: string
  previewUrl: string | null
  durationMs: number
  albumName: string
  albumImageUrl: string | null
  source: "itunes" | "spotify" | "deezer"
}

interface ArtistWithTracks {
  id: string
  name: string
  genres: string[]
  imageUrl: string | null
  popularity: number
  topTracks: Track[]
}

interface Recommendation {
  spotify_artist_id: string
  artist_data: ArtistWithTracks
  score: number
  why: {
    sourceArtists: string[]
    genres: string[]
    friendBoost: string[]
  }
  artist_color?: string | null
}

interface FeedClientProps {
  recommendations: Recommendation[]
  musicPlatform: MusicPlatform
}

// ---------------------------------------------------------------------------
// Feed sequence builder
// ---------------------------------------------------------------------------

type FeedItem = { kind: "card"; rec: Recommendation; key: string }

function buildSequence(recs: Recommendation[]): FeedItem[] {
  return recs.map((rec) => ({ kind: "card", rec, key: `c-${rec.spotify_artist_id}` }))
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function FeedClient({ recommendations, musicPlatform }: FeedClientProps) {
  const [dismissedSignals, setDismissedSignals] = useState<Map<string, string>>(new Map())
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set())
  const [isGenerating, setIsGenerating] = useState(false)
  const [genreFilter, setGenreFilter] = useState<string | null>(null)
  const [filterOpen, setFilterOpen] = useState(false)
  const [showAllGenres, setShowAllGenres] = useState(false)
  const router = useRouter()

  // Count how many artists each genre matches so we can rank chips by
  // usefulness (and hide single-match noise by default). Spotify returns
  // hyper-specific tags so a 20-artist feed can easily expose 60+ genres,
  // most of which would filter down to 1 artist — unhelpful.
  const genreCounts = useMemo(() => {
    const map = new Map<string, number>()
    for (const r of recommendations) {
      for (const g of r.artist_data.genres) map.set(g, (map.get(g) ?? 0) + 1)
    }
    return map
  }, [recommendations])

  const sortedGenres = useMemo(
    () =>
      Array.from(genreCounts.entries())
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .map(([g]) => g),
    [genreCounts],
  )

  // Default view: only genres shared by ≥2 artists, capped at 10. "Show all"
  // reveals every tag for power users.
  const visibleGenres = useMemo(() => {
    if (showAllGenres) return sortedGenres
    return sortedGenres.filter((g) => (genreCounts.get(g) ?? 0) >= 2).slice(0, 10)
  }, [sortedGenres, genreCounts, showAllGenres])

  const hiddenGenreCount = sortedGenres.length - visibleGenres.length

  const filteredRecs = useMemo(
    () =>
      genreFilter
        ? recommendations.filter((r) =>
            r.artist_data.genres.some((g) => normalizedIncludes(g, genreFilter))
          )
        : recommendations,
    [recommendations, genreFilter]
  )

  const activeRec = filteredRecs.find((r) => !dismissedSignals.has(r.spotify_artist_id))
  const activeAuraColor = sanitizeHex(activeRec?.artist_color)

  const sequence = useMemo(
    () => buildSequence(filteredRecs),
    [filteredRecs]
  )

  async function handleFeedback(artistId: string, signal: string) {
    setDismissedSignals((prev) => new Map(prev).set(artistId, signal))
    try {
      const res = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ spotifyArtistId: artistId, signal }),
      })
      if (!res.ok) throw new Error("Server error")
    } catch {
      setDismissedSignals((prev) => {
        const next = new Map(prev)
        next.delete(artistId)
        return next
      })
      toast.error("Couldn't save feedback — try again")
    }
  }

  async function handleGenerateMore() {
    setIsGenerating(true)
    try {
      const url = genreFilter
        ? `/api/recommendations/generate?genre=${encodeURIComponent(genreFilter)}`
        : "/api/recommendations/generate"
      const res = await fetch(url, { method: "POST" })
      if (res.status === 401) {
        window.location.href = "/sign-in"
        return
      }
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error((data as { error?: string }).error ?? "Generation failed")
      }
      const data = (await res.json().catch(() => ({}))) as {
        softenedFilters?: { playThreshold?: boolean; undergroundMode?: boolean; coldStart?: boolean }
      }
      if (data.softenedFilters) {
        const s = data.softenedFilters
        const bits: string[] = []
        if (s.coldStart) bits.push("falling back to starter picks")
        else {
          if (s.playThreshold) bits.push("loosening the familiarity cap")
          if (s.undergroundMode) bits.push("turning off the hard pop-50 cutoff")
        }
        if (bits.length > 0) {
          toast(`Widened the search for this batch — ${bits.join(" and ")}.`)
        }
      }
      router.refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Generation failed")
    } finally {
      setIsGenerating(false)
    }
  }

  async function handleSave(artistId: string) {
    if (savedIds.has(artistId)) {
      setSavedIds((prev) => { const n = new Set(prev); n.delete(artistId); return n })
      try {
        const res = await fetch("/api/saves", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ spotifyArtistId: artistId }),
        })
        if (!res.ok) throw new Error("Server error")
      } catch {
        setSavedIds((prev) => new Set(prev).add(artistId))
        toast.error("Couldn't unsave — try again")
      }
    } else {
      setSavedIds((prev) => new Set(prev).add(artistId))
      try {
        const res = await fetch("/api/saves", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ spotifyArtistId: artistId }),
        })
        if (!res.ok) throw new Error("Server error")
      } catch {
        setSavedIds((prev) => { const n = new Set(prev); n.delete(artistId); return n })
        toast.error("Couldn't save — try again")
      }
    }
  }

  return (
    <div style={{ position: "relative" }}>
      {/* Ambient aura */}
      <div
        aria-hidden
        style={{
          position: "fixed",
          top: "15%",
          left: "50%",
          transform: "translateX(-50%)",
          width: 700,
          height: 700,
          pointerEvents: "none",
          zIndex: -1,
          background: `radial-gradient(circle, ${hexToRgba(activeAuraColor, 0.4)} 0%, transparent 65%)`,
          transition: "background 1s",
        }}
      />

      {/* Page header */}
      <div className="page-head">
        <h1>Today&apos;s feed</h1>
        <span className="sub">{filteredRecs.length} artists</span>
      </div>

      {/* Genre filter — collapsed by default so the feed stays the focus.
          Shows only the active filter + a disclosure toggle until opened. */}
      {sortedGenres.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <button
              type="button"
              className="chip"
              onClick={() => setFilterOpen((v) => !v)}
              aria-expanded={filterOpen}
              style={{ fontSize: 12 }}
            >
              {filterOpen ? "Hide filters" : "Filter by genre"}
              <span aria-hidden style={{ marginLeft: 6, opacity: 0.6 }}>
                {filterOpen ? "▴" : "▾"}
              </span>
            </button>
            {genreFilter && (
              <>
                <span className="chip selected" style={{ fontSize: 12 }}>
                  {genreFilter}
                </span>
                <button
                  type="button"
                  className="chip"
                  onClick={() => setGenreFilter(null)}
                  style={{ fontSize: 12 }}
                >
                  Clear
                </button>
              </>
            )}
          </div>

          {filterOpen && (
            <div
              style={{
                display: "flex",
                gap: 6,
                flexWrap: "wrap",
                marginTop: 10,
                paddingTop: 10,
                borderTop: "1px solid var(--border)",
              }}
            >
              <button
                className={"chip" + (genreFilter === null ? " selected" : "")}
                onClick={() => setGenreFilter(null)}
              >
                All
              </button>
              {visibleGenres.map((g) => {
                const count = genreCounts.get(g) ?? 0
                return (
                  <button
                    key={g}
                    className={"chip" + (genreFilter === g ? " selected" : "")}
                    onClick={() => setGenreFilter(genreFilter === g ? null : g)}
                    title={`${count} artist${count === 1 ? "" : "s"}`}
                  >
                    {g}
                    <span className="muted" style={{ marginLeft: 4, fontSize: 10 }}>
                      {count}
                    </span>
                  </button>
                )
              })}
              {hiddenGenreCount > 0 && (
                <button
                  type="button"
                  className="chip"
                  onClick={() => setShowAllGenres((v) => !v)}
                  style={{ fontSize: 12 }}
                >
                  {showAllGenres ? "Show fewer" : `Show all (+${hiddenGenreCount})`}
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {/* Feed sequence */}
      <div className="col" style={{ gap: 24, marginTop: 8 }}>
        {sequence.map((item) => {
          const { rec } = item
          return (
            <ArtistCard
              key={item.key}
              recommendation={rec}
              musicPlatform={musicPlatform}
              onSave={() => handleSave(rec.spotify_artist_id)}
              isSaved={savedIds.has(rec.spotify_artist_id)}
              onFeedback={(signal) => handleFeedback(rec.spotify_artist_id, signal)}
              isDismissed={dismissedSignals.has(rec.spotify_artist_id)}
              dismissSignal={dismissedSignals.get(rec.spotify_artist_id) ?? null}
            />
          )
        })}

        {/* Load more */}
        <div style={{ display: "flex", justifyContent: "center", padding: "24px 0 8px" }}>
          <button className="btn" onClick={handleGenerateMore} disabled={isGenerating}>
            {isGenerating ? (
              <span className="mono" style={{ fontSize: 12 }}>Generating…</span>
            ) : genreFilter ? (
              `More ${genreFilter} artists`
            ) : (
              "Load more artists"
            )}
          </button>
        </div>
      </div>
    </div>
  )
}
