"use client"

import { useEffect, useRef, useState, useSyncExternalStore } from "react"
import { useRouter } from "next/navigation"
import { FeedDesktop } from "@/components/feed/feed-desktop"
import { FeedShortcuts } from "@/components/feed/feed-shortcuts"
import { FeedSnap } from "@/components/feed/feed-snap"
import { FeedTablet } from "@/components/feed/feed-tablet"
import { useShellBadge } from "@/components/shell/shell-context"
import type { MusicPlatform } from "@/lib/music-links"
import { useFeedFill } from "@/lib/hooks/use-feed-fill"
import { useFeedGeneration } from "@/lib/hooks/use-feed-generation"
import { useFeedTriage } from "@/lib/hooks/use-feed-triage"
import type { CardArtist } from "@/lib/cards/card-artist"
import type { GenerateResult } from "@/lib/client/feed-generation"

interface FeedClientProps {
  recommendations: CardArtist[]
  musicPlatform: MusicPlatform
  signalCount: number
}

// Below this many unseen recs on load, quietly top up in the background so the
// next visit opens on a full queue. The visible feed is unchanged this load;
// new recs land server-side for next time.
const TOPUP_THRESHOLD = 8

// One layout at a time (PRD "Breakpoints"): ≥900px desktop, 640–899px tablet,
// below 640px the Snap feed. The server (and hydration) renders the Snap tree:
// it is what the slowest clients need, and feed.css hides it at ≥640px until
// the client switches, so wider screens never flash a phone layout.
type Layout = "phone" | "tablet" | "desktop"
const QUERIES = ["(min-width: 900px)", "(min-width: 640px)"]
const subscribeLayout = (cb: () => void) => {
  const ms = QUERIES.map((q) => matchMedia(q))
  ms.forEach((m) => m.addEventListener("change", cb))
  return () => ms.forEach((m) => m.removeEventListener("change", cb))
}
const currentLayout = (): Layout =>
  matchMedia(QUERIES[0]).matches ? "desktop" : matchMedia(QUERIES[1]).matches ? "tablet" : "phone"
const serverLayout = (): Layout => "phone"

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
    }
    // Mount-only: deliberately not re-firing on recommendations identity change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Unmount (navigation): release the generation guard so a run still in
  // flight stays quiet, and don't refresh the page the user moved to. Separate
  // from the top-up effect, which returns early on a full queue.
  const aliveRef = useRef(true)
  const releaseGeneration = generation.release
  useEffect(() => {
    aliveRef.current = true
    return () => {
      aliveRef.current = false
      releaseGeneration()
    }
  }, [releaseGeneration])

  // Selection, verdicts (feedback signals), saves and playback, shared by all
  // layouts (so resizing keeps them). Serialization and rollback live in the feedback/saves hooks.
  const triage = useFeedTriage(recs, musicPlatform)
  const { savedIds } = triage

  // Saved badge in the rail / tab bar: artists saved since the feed opened.
  const [savedAtMount] = useState(savedIds.size)
  useShellBadge("/saved", Math.max(0, savedIds.size - savedAtMount))
  // Feed badge: artists still undecided (hidden at zero).
  useShellBadge("/feed", triage.remaining)
  const layout = useSyncExternalStore(subscribeLayout, currentLayout, serverLayout)

  async function handleGenerateMore() {
    const r = await generation.requestMore()
    if (r === null || !aliveRef.current) return
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

  const View = layout === "desktop" ? FeedDesktop : layout === "tablet" ? FeedTablet : FeedSnap
  return (
    <>
      <FeedShortcuts triage={triage} />
      <View triage={triage} signalCount={signalCount} onLoadMore={handleGenerateMore} generating={isGenerating} />
    </>
  )
}
