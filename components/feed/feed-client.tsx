"use client"

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { ArtistCard } from "@/components/feed/artist-card"
import { ColdStartBanner } from "@/components/feed/cold-start-banner"
import { Ambient } from "@/components/visual/ambient"
import type { MusicPlatform } from "@/lib/music-links"
import { useArtistFeedback } from "@/lib/hooks/use-artist-feedback"
import { useArtistSaves } from "@/lib/hooks/use-artist-saves"
import { useFeedFill } from "@/lib/hooks/use-feed-fill"

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

// Module-scope: zero prop/state deps, so identity stays stable across renders.
const FEED_PALETTE = `
    radial-gradient(50% 40% at 18% 20%, rgba(139, 92, 246, 0.22) 0%, transparent 70%),
    radial-gradient(55% 45% at 82% 30%, rgba(236, 111, 181, 0.18) 0%, transparent 70%),
    radial-gradient(70% 55% at 50% 90%, rgba(125, 217, 198, 0.14) 0%, transparent 70%)
  `

// Below this many unseen recs on load, quietly top up in the background so the
// next visit hits the warm redirect path (hasFreshRecs stays true). The visible
// feed is unchanged this load; new recs land server-side for next time.
const TOPUP_THRESHOLD = 8

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function FeedClient({ recommendations, musicPlatform, signalCount }: FeedClientProps) {
  const [isGenerating, setIsGenerating] = useState(false)
  // Synchronous guard: React state updates are batched, so a hair-trigger
  // double-click can slip past `disabled={isGenerating}` and fire two requests
  // before the first render commits. The ref blocks the second call instantly.
  const isGeneratingRef = useRef(false)
  const router = useRouter()

  // Stateful rec list: seeded from the prop on mount. The append-poller below
  // grows this list in the background. Existing cards (earlier indices) are never
  // reordered or removed — appended recs land at the end. Keyed by
  // spotify_artist_id so React never remounts an existing card on append.
  const [recs, setRecs] = useState<Recommendation[]>(recommendations)

  // Append-poller: after first paint, poll for newly-confirmed cards that the
  // background after() block has written. Appends deduped, playable-only recs to
  // the end of the list without disturbing the current/earlier cards.
  useFeedFill<Recommendation>({
    initialIds: recommendations.map((r) => r.spotify_artist_id),
    targetCount: 20,
    onAppend: (newRecs) => {
      setRecs((prev) => {
        const seenIds = new Set(prev.map((r) => r.spotify_artist_id))
        const deduped = newRecs.filter((r) => !seenIds.has(r.spotify_artist_id))
        if (deduped.length === 0) return prev
        return [...prev, ...deduped]
      })
    },
  })

  // Background top-up: when the unseen queue is low, generate more on mount and
  // surface the results via router.refresh() once done. We reflect the in-flight
  // run on the button (shared isGeneratingRef + isGenerating state) so a user's
  // own "Load more" can't silently collide with it or trip the 30s-cooldown
  // error path — and the refresh means their implicit "I want more" intent is
  // fulfilled. Cooldown-safe: a 429 just no-ops, then refresh shows whatever's
  // available. router.refresh() is a soft refresh (preserves scroll/state), and
  // it doesn't remount this client component, so the mount-only effect won't loop.
  useEffect(() => {
    if (recommendations.length >= TOPUP_THRESHOLD) return
    if (isGeneratingRef.current) return
    isGeneratingRef.current = true
    setIsGenerating(true)
    let cancelled = false
    fetch("/api/recommendations/generate", { method: "POST" })
      .catch(() => {})
      .finally(() => {
        if (cancelled) return
        isGeneratingRef.current = false
        setIsGenerating(false)
        router.refresh()
      })
    return () => {
      cancelled = true
      isGeneratingRef.current = false
    }
    // Mount-only: deliberately not re-firing on recommendations identity change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const sequence = useMemo(() => buildSequence(recs), [recs])

  // Feedback signals (thumbs_up / thumbs_down / skip) per artist.
  // Serialization and rollback are handled inside the hook.
  const { signals: dismissedSignals, setSignal } = useArtistFeedback({
    errorMessages: {
      undoFailed: "Couldn't undo — try again",
      saveFailed: "Couldn't save feedback — try again",
    },
  })

  // Saved-artist IDs. Serialization and rollback are handled inside the hook.
  const { savedIds, toggleSave } = useArtistSaves()

  const handleFeedback = useCallback(
    (artistId: string, signal: string) => setSignal(artistId, signal),
    [setSignal],
  )

  const handleSave = useCallback(
    (artistId: string) => toggleSave(artistId),
    [toggleSave],
  )

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

  return (
    <div style={{ position: "relative" }}>
      <Ambient palette={FEED_PALETTE} />

      {/* Page header */}
      <div className="page-head">
        <h1>Today&apos;s feed</h1>
        <span className="sub">{recs.length} artists</span>
      </div>

      {/* Feed sequence */}
      <div className="col" style={{ gap: 24, marginTop: 8 }}>
        <ColdStartBanner signalCount={signalCount} />
        {sequence.map((item, index) => {
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
              priority={index === 0}
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
  priority?: boolean
}

const FeedCardRow = memo(function FeedCardRow({
  rec,
  musicPlatform,
  isSaved,
  dismissSignal,
  onSaveAction,
  onFeedbackAction,
  priority = false,
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
      priority={priority}
    />
  )
})
