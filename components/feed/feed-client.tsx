"use client"

import { useState, useMemo, useRef } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { ArtistCard } from "@/components/feed/artist-card"
import { ColdStartBanner } from "@/components/feed/cold-start-banner"
import { Ambient } from "@/components/visual/ambient"
import type { MusicPlatform } from "@/lib/music-links"
import { createKeyedSerializer } from "@/lib/keyed-serializer"

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
  signalCount: number
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

export function FeedClient({ recommendations, musicPlatform, signalCount }: FeedClientProps) {
  const [dismissedSignals, setDismissedSignals] = useState<Map<string, string>>(new Map())
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set())
  const [isGenerating, setIsGenerating] = useState(false)
  // Synchronous guard: React state updates are batched, so a hair-trigger
  // double-click can slip past `disabled={isGenerating}` and fire two requests
  // before the first render commits. The ref blocks the second call instantly.
  const isGeneratingRef = useRef(false)
  const saveQueueRef = useRef(createKeyedSerializer())
  const router = useRouter()

  const palette = `
    radial-gradient(50% 40% at 18% 20%, rgba(139, 92, 246, 0.22) 0%, transparent 70%),
    radial-gradient(55% 45% at 82% 30%, rgba(236, 111, 181, 0.18) 0%, transparent 70%),
    radial-gradient(70% 55% at 50% 90%, rgba(125, 217, 198, 0.14) 0%, transparent 70%)
  `

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
    if (isGeneratingRef.current) return
    isGeneratingRef.current = true
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
      isGeneratingRef.current = false
      setIsGenerating(false)
    }
  }

  async function handleSave(artistId: string) {
    const willUnsave = savedIds.has(artistId)
    setSavedIds((prev) => {
      const n = new Set(prev)
      if (willUnsave) n.delete(artistId)
      else n.add(artistId)
      return n
    })
    // Serialize per-artist so rapid save/unsave clicks hit the server in
    // click order. Without this, POST/DELETE can interleave and the final
    // server state can disagree with the user's last intent.
    return saveQueueRef.current(artistId, async () => {
      try {
        const res = await fetch("/api/saves", {
          method: willUnsave ? "DELETE" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ spotifyArtistId: artistId }),
        })
        if (!res.ok) throw new Error("Server error")
      } catch {
        setSavedIds((prev) => {
          const n = new Set(prev)
          if (willUnsave) n.add(artistId)
          else n.delete(artistId)
          return n
        })
        toast.error(willUnsave ? "Couldn't unsave — try again" : "Couldn't save — try again")
      }
    })
  }

  return (
    <div style={{ position: "relative" }}>
      <Ambient palette={palette} />

      {/* Page header */}
      <div className="page-head">
        <h1>Today&apos;s feed</h1>
        <span className="sub">{recommendations.length} artists</span>
      </div>

      {/* Feed sequence */}
      <div className="col" style={{ gap: 24, marginTop: 8 }}>
        <ColdStartBanner signalCount={signalCount} />
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
