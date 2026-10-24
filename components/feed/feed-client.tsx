"use client"

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { ArtistCard } from "@/components/feed/artist-card"
import { ColdStartBanner } from "@/components/feed/cold-start-banner"
import { Ambient } from "@/components/visual/ambient"
import type { MusicPlatform } from "@/lib/music-links"
import { useArtistFeedback } from "@/lib/hooks/use-artist-feedback"
import { useArtistSaves } from "@/lib/hooks/use-artist-saves"
import { useFeedFill } from "@/lib/hooks/use-feed-fill"
import { useFeedGeneration } from "@/lib/hooks/use-feed-generation"
import type { CardArtist } from "@/lib/cards/card-artist"
import type { GenerateResult } from "@/lib/client/feed-generation"

interface FeedClientProps {
  recommendations: CardArtist[]
  musicPlatform: MusicPlatform
  signalCount: number
}

// ---------------------------------------------------------------------------
// Feed sequence builder
// ---------------------------------------------------------------------------

type FeedItem = { kind: "card"; rec: CardArtist; key: string }

function buildSequence(recs: CardArtist[]): FeedItem[] {
  return recs.map((rec) => ({ kind: "card", rec, key: `c-${rec.id}` }))
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
  // Generate requests (mount top-up + Load more) share one re-entry guard, so
  // a user's own "Load more" can't collide with the background top-up.
  const generation = useFeedGeneration()
  const isGenerating = generation.generating
  const router = useRouter()

  // Stateful rec list: seeded from the prop on mount. The append-poller below
  // grows this list in the background. Existing cards (earlier indices) are never
  // reordered or removed — appended recs land at the end. Keyed by
  // artist_id so React never remounts an existing card on append.
  const [recs, setRecs] = useState<CardArtist[]>(recommendations)

  // Append-poller: after first paint, poll for newly-confirmed cards that the
  // background after() block has written. Appends deduped, playable-only recs to
  // the end of the list without disturbing the current/earlier cards.
  const { restart: restartFeedFill } = useFeedFill<CardArtist>({
    initialIds: recommendations.map((r) => r.id),
    targetCount: 20,
    onAppend: (newRecs) => {
      setRecs((prev) => {
        const seenIds = new Set(prev.map((r) => r.id))
        const deduped = newRecs.filter((r) => !seenIds.has(r.id))
        if (deduped.length === 0) return prev
        return [...prev, ...deduped]
      })
    },
  })

  // Background top-up: when the unseen queue is low, generate more on mount and
  // surface the results via router.refresh() once done. The in-flight run is
  // reflected on the button (shared generation guard). Silent: a 429 / failure
  // just no-ops, then refresh shows whatever's available. router.refresh() is a
  // soft refresh (preserves scroll/state), and it doesn't remount this client
  // component, so the mount-only effect won't loop.
  // StrictMode (dev) re-runs this effect on the same instance: the second run
  // reuses the first run's POST instead of firing another (which would 429 and
  // skip restartFeedFill). Production runs it once, so the ref starts empty.
  const topUpRef = useRef<Promise<GenerateResult | null> | null>(null)
  useEffect(() => {
    if (recommendations.length >= TOPUP_THRESHOLD) return
    let cancelled = false
    topUpRef.current ??= generation.requestMore({ silent: true })
    void topUpRef.current.then((r) => {
      if (r === null || cancelled) return
      // New cards land server-side; restart the poller so they surface
      // without waiting for a hard navigation (router.refresh() alone
      // doesn't re-arm an already-stopped/never-started poller).
      if (r.ok) restartFeedFill()
      router.refresh()
    })
    return () => {
      cancelled = true
      generation.release()
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

  async function handleGenerateMore() {
    const r = await generation.requestMore()
    if (r === null) return
    if (r.kind === "unauthorized") {
      window.location.href = "/sign-in"
      return
    }
    if (r.ok) {
      // New cards land server-side; restart the poller so they surface
      // without waiting for a hard navigation.
      restartFeedFill()
      router.refresh()
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
          const id = rec.id
          return (
            <FeedCardRow
              key={item.key}
              rec={rec}
              musicPlatform={musicPlatform}
              isSaved={savedIds.has(id)}
              dismissSignal={dismissedSignals.get(id) ?? null}
              onSaveAction={toggleSave}
              onFeedbackAction={setSignal}
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
  rec: CardArtist
  musicPlatform: MusicPlatform
  isSaved: boolean
  dismissSignal: string | null
  onSaveAction: (artistId: string) => unknown
  onFeedbackAction: (artistId: string, signal: string) => unknown
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
  const id = rec.id
  const onSave = useCallback(() => { void onSaveAction(id) }, [id, onSaveAction])
  const onFeedback = useCallback((signal: string) => { void onFeedbackAction(id, signal) }, [id, onFeedbackAction])
  return (
    <ArtistCard
      artist={rec}
      musicPlatform={musicPlatform}
      isSaved={isSaved}
      dismissSignal={dismissSignal}
      onSave={onSave}
      onFeedback={onFeedback}
      priority={priority}
    />
  )
})
