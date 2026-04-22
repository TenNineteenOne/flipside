"use client"

import { useState, useMemo } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { ArtistCard } from "@/components/feed/artist-card"
import { hexToRgba, sanitizeHex } from "@/lib/color-utils"
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
  const router = useRouter()

  const activeRec = recommendations.find((r) => !dismissedSignals.has(r.spotify_artist_id))
  const activeAuraColor = sanitizeHex(activeRec?.artist_color)

  const sequence = useMemo(() => buildSequence(recommendations), [recommendations])

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
      const res = await fetch("/api/recommendations/generate", { method: "POST" })
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
        <span className="sub">{recommendations.length} artists</span>
      </div>

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
            ) : (
              "Load more artists"
            )}
          </button>
        </div>
      </div>
    </div>
  )
}
