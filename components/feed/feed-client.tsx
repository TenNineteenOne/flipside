"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { CheckCircle2, Sparkles } from "lucide-react"
import { ArtistCard } from "@/components/feed/artist-card"

interface Track {
  id: string
  spotifyTrackId: string | null
  name: string
  previewUrl: string | null
  durationMs: number
  albumName: string
  albumImageUrl: string | null
  source: 'itunes' | 'spotify' | 'deezer'
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
}

// ---------------------------------------------------------------------------
// Hex → RGBA helper for ambient aura
// ---------------------------------------------------------------------------
function hexToRgba(hex: string, alpha: number): string {
  const cleaned = hex.replace(/^#/, "")
  const full = cleaned.length === 3 ? cleaned.split("").map((c) => c + c).join("") : cleaned
  const num = parseInt(full.slice(0, 6), 16)
  return `rgba(${(num >> 16) & 0xff}, ${(num >> 8) & 0xff}, ${num & 0xff}, ${alpha})`
}

export function FeedClient({ recommendations }: FeedClientProps) {


  // In-memory dismissed cards — resets on mount (page refresh restores all)
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(new Set())

  // Permanently saved artists — removed from the feed
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set())

  const router = useRouter()
  const [isGenerating, setIsGenerating] = useState(false)

  async function handleFeedback(artistId: string, signal: string) {
    setDismissedIds((prev) => new Set(prev).add(artistId))
    try {
      await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ spotifyArtistId: artistId, signal }),
      })
    } catch (err) {
      console.error("[feed-client] feedback failed", err)
    }
  }

  async function handleGenerateMore() {
    setIsGenerating(true)
    try {
      await fetch("/api/recommendations/generate", { method: "POST" })
    } catch (err) {}
    
    router.refresh()
    setTimeout(() => setIsGenerating(false), 2000)
  }

  async function handleSave(artistId: string) {
    if (savedIds.has(artistId)) {
      setSavedIds((prev) => {
        const next = new Set(prev)
        next.delete(artistId)
        return next
      })
      try {
        await fetch("/api/saves", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ spotifyArtistId: artistId }),
        })
      } catch (err) {}
    } else {
      setSavedIds((prev) => new Set(prev).add(artistId))
      try {
        await fetch("/api/saves", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ spotifyArtistId: artistId }),
        })
      } catch (err) {
        console.error("[feed-client] save failed", err)
      }
    }
  }

  // Saved and dismissed cards stay in DOM for collapse animation and Undo to work
  const visibleRecs = recommendations

  const allCaughtUp = visibleRecs.every(r => dismissedIds.has(r.spotify_artist_id))

  // Determine top active card to drive aura color
  const activeRec = visibleRecs.find(r => !dismissedIds.has(r.spotify_artist_id))
  const activeAuraColor = activeRec?.artist_color ?? '#8b5cf6'

  return (
    <div className="relative min-h-screen w-full flex flex-col items-center pt-8 pb-[200px]">
      {/* Option 11 Ambient Aura */}
      <div 
        className="fixed top-[20%] left-1/2 -translate-x-1/2 w-[700px] h-[700px] -z-10 pointer-events-none transition-all duration-1000 ease-in-out"
        style={{ background: `radial-gradient(circle at center, ${hexToRgba(activeAuraColor, 0.45)} 0%, transparent 65%)` }}
      />

      <div className="w-full max-w-[500px] px-4 flex flex-col gap-6">
        {allCaughtUp ? (
          <div className="flex flex-col items-center justify-center gap-3 py-20 text-center">
            <div className="flex size-14 items-center justify-center rounded-full bg-primary/10 ring-1 ring-primary/20 backdrop-blur-md">
              <CheckCircle2 className="size-7 text-primary" />
            </div>
            <p className="text-base font-semibold text-white drop-shadow-md">
              You&apos;re all caught up!
            </p>
            <p className="text-sm text-gray-400">Want another batch?</p>
            <button
              onClick={handleGenerateMore}
              disabled={isGenerating}
              className="mt-2 inline-flex items-center justify-center gap-2 h-11 px-6 rounded-xl bg-primary text-black font-semibold text-sm transition-all hover:opacity-90 shadow-[0_0_20px_rgba(139,92,246,0.3)] disabled:opacity-50"
            >
              {isGenerating ? (
                  <><div className="w-4 h-4 border-2 border-black/20 border-t-black rounded-full animate-spin" /> Generating...</>
              ) : (
                  <><Sparkles className="size-4" /> Generate More Artists</>
              )}
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-8 w-full">
            {visibleRecs.map((rec) => (
              <ArtistCard
                key={rec.spotify_artist_id}
                recommendation={rec}
                onSave={() => handleSave(rec.spotify_artist_id)}
                isSaved={savedIds.has(rec.spotify_artist_id)}
                onFeedback={(signal) => handleFeedback(rec.spotify_artist_id, signal)}
                isDismissed={dismissedIds.has(rec.spotify_artist_id)}
              />
            ))}

            {/* Inline Generate More Button */}
            <div className="flex justify-center mt-6 mb-12">
              <button
                onClick={handleGenerateMore}
                disabled={isGenerating}
                className="inline-flex items-center justify-center gap-2 h-12 px-6 rounded-2xl bg-white/5 border border-white/10 text-white font-semibold text-[15px] transition-all hover:bg-white/10 hover:shadow-[0_0_20px_rgba(255,255,255,0.1)] disabled:opacity-50"
              >
                {isGenerating ? (
                    <><div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Generating Artists...</>
                ) : (
                    <><Sparkles className="size-4" /> Load More Artists</>
                )}
              </button>
            </div>
          </div>
        )}
      </div>


    </div>
  )
}
