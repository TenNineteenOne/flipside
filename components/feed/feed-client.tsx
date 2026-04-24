"use client"

import { memo, useCallback, useMemo, useRef, useState } from "react"
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
  // Mirror queue for feedback so rapid taps on the same artist (like → unlike
  // → like) serialize on the server. Without this, DELETE and POST can race
  // and the final server state can disagree with the user's last intent.
  const feedbackQueueRef = useRef(createKeyedSerializer())
  const router = useRouter()

  const palette = `
    radial-gradient(50% 40% at 18% 20%, rgba(139, 92, 246, 0.22) 0%, transparent 70%),
    radial-gradient(55% 45% at 82% 30%, rgba(236, 111, 181, 0.18) 0%, transparent 70%),
    radial-gradient(70% 55% at 50% 90%, rgba(125, 217, 198, 0.14) 0%, transparent 70%)
  `

  const sequence = useMemo(() => buildSequence(recommendations), [recommendations])

  // Ref mirrors dismissedSignals so handleFeedback can read the current state
  // without re-creating its identity on every dismiss (preserves FeedCardRow
  // memoization).
  const dismissedSignalsRef = useRef(dismissedSignals)
  dismissedSignalsRef.current = dismissedSignals

  const handleFeedback = useCallback((artistId: string, signal: string) => {
    // Serialize per-artist so rapid like/unlike taps hit the server in order;
    // otherwise POST and DELETE can interleave and the final server state
    // won't match the user's last intent. Same pattern as handleSave above.
    return feedbackQueueRef.current(artistId, async () => {
      // Thumbs-up toggle: if already liked, tapping again un-likes
      // (soft-deletes the feedback row via rpc_delete_feedback). Migration
      // 0033 leaves seen_at set, so the card still won't return on next
      // refresh — undo is session-only.
      const currentSignal = dismissedSignalsRef.current.get(artistId)
      if (signal === "thumbs_up" && currentSignal === "thumbs_up") {
        setDismissedSignals((prev) => {
          const next = new Map(prev)
          next.delete(artistId)
          return next
        })
        try {
          const res = await fetch(`/api/feedback/${encodeURIComponent(artistId)}`, { method: "DELETE" })
          if (!res.ok && res.status !== 204) throw new Error("Server error")
        } catch {
          setDismissedSignals((prev) => new Map(prev).set(artistId, "thumbs_up"))
          toast.error("Couldn't undo — try again")
        }
        return
      }

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
          if (currentSignal === undefined) next.delete(artistId)
          else next.set(artistId, currentSignal)
          return next
        })
        toast.error("Couldn't save feedback — try again")
      }
    })
  }, [])

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
        softenedFilters?: { playThreshold?: boolean; coldStart?: boolean }
      }
      if (data.softenedFilters) {
        const s = data.softenedFilters
        const bits: string[] = []
        if (s.coldStart) bits.push("falling back to starter picks")
        else if (s.playThreshold) bits.push("loosening the familiarity cap")
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

  // Ref mirrors savedIds so handleSave stays identity-stable across renders —
  // otherwise every setSavedIds would bust memoization on every card.
  const savedIdsRef = useRef(savedIds)
  savedIdsRef.current = savedIds

  const handleSave = useCallback(async (artistId: string) => {
    const willUnsave = savedIdsRef.current.has(artistId)
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
  }, [])

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
          const id = rec.spotify_artist_id
          return (
            <FeedCardRow
              key={item.key}
              rec={rec}
              musicPlatform={musicPlatform}
              isSaved={savedIds.has(id)}
              dismissSignal={dismissedSignals.get(id) ?? null}
              onSaveAction={handleSave}
              onFeedbackAction={handleFeedback}
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

// Per-row wrapper that binds the stable parent actions to this row's artistId.
// Memoized so a parent re-render (e.g. on save of a different card) doesn't
// re-render this row unless its own props actually changed.
interface FeedCardRowProps {
  rec: Recommendation
  musicPlatform: MusicPlatform
  isSaved: boolean
  dismissSignal: string | null
  onSaveAction: (artistId: string) => Promise<void> | void
  onFeedbackAction: (artistId: string, signal: string) => Promise<void> | void
}

const FeedCardRow = memo(function FeedCardRow({
  rec,
  musicPlatform,
  isSaved,
  dismissSignal,
  onSaveAction,
  onFeedbackAction,
}: FeedCardRowProps) {
  const id = rec.spotify_artist_id
  const onSave = useCallback(() => { void onSaveAction(id) }, [id, onSaveAction])
  const onFeedback = useCallback((signal: string) => { void onFeedbackAction(id, signal) }, [id, onFeedbackAction])
  return (
    <ArtistCard
      recommendation={rec}
      musicPlatform={musicPlatform}
      isSaved={isSaved}
      dismissSignal={dismissSignal}
      onSave={onSave}
      onFeedback={onFeedback}
    />
  )
})
