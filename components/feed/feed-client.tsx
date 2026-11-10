"use client"

import { useEffect, useRef, useState, useSyncExternalStore } from "react"
import dynamic from "next/dynamic"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { FeedShortcuts } from "@/components/feed/feed-shortcuts"
import { FeedSkeleton } from "@/components/feed/feed-skeleton"
import { useShellBadge } from "@/components/shell/shell-context"
import type { MusicPlatform } from "@/lib/music-links"
import { useFeedFill } from "@/lib/hooks/use-feed-fill"
import { useFeedGeneration } from "@/lib/hooks/use-feed-generation"
import { useFeedTriage } from "@/lib/hooks/use-feed-triage"
import { useAdventurousMode } from "@/lib/hooks/use-adventurous-mode"
import type { CardArtist } from "@/lib/cards/card-artist"
import type { GenerateResult } from "@/lib/client/feed-generation"
import type { FeedLayout } from "@/lib/feed/layout-guess"

// Each layout is its own chunk, so a device downloads only the one it shows (the Snap
// layout also brings the swipe code). The layout the server rendered has its chunk
// preloaded by the page; switching to another (a wrong guess, a resize) shows the
// skeleton while that chunk loads. Once the first layout is up, the other two are
// fetched when the browser is idle (FeedClient), so a later switch needs no network.
// A chunk that still fails to load (offline, or gone after a new deploy) is tried again
// every few seconds while the skeleton stays, instead of the feed turning into the error page.
const RETRY_MS = 4000
function retry<T>(load: () => Promise<T>): Promise<T> {
  return load().catch(() => new Promise<T>((resolve) => setTimeout(() => resolve(retry(load)), RETRY_MS)))
}
// The loaders are kept for preloading. The import() must stay inside each dynamic() call: Next
// compiles it there as the layout's own chunk (and preloads it when server-rendered); a plain
// import() elsewhere would fetch a separate copy.
const loaders: (() => Promise<unknown>)[] = []
const keep = <T,>(load: () => Promise<T>) => (loaders.push(load), load)
const FeedDesktop = dynamic(keep(() => retry(() => import("@/components/feed/feed-desktop")).then((m) => m.FeedDesktop)), { loading: FeedSkeleton })
const FeedTablet = dynamic(keep(() => retry(() => import("@/components/feed/feed-tablet")).then((m) => m.FeedTablet)), { loading: FeedSkeleton })
const FeedSnap = dynamic(keep(() => retry(() => import("@/components/feed/feed-snap")).then((m) => m.FeedSnap)), { loading: FeedSkeleton })
/** Load every layout chunk now (the one on screen costs nothing), so a later layout switch needs no network. */
const preloadLayouts = () => loaders.forEach((load) => void load())

interface FeedClientProps {
  recommendations: CardArtist[]
  musicPlatform: MusicPlatform
  signalCount: number
  /** users.adventurous: Wander farther, shown beside every Load more. */
  initialAdventurous?: boolean
  /** The server's guess (lib/feed/layout-guess) for the first render; matchMedia takes over after hydration. */
  initialLayout?: FeedLayout
}

// Below this many unseen recs on load, quietly top up in the background so the
// next visit opens on a full queue. The visible feed is unchanged this load;
// new recs land server-side for next time.
const TOPUP_THRESHOLD = 8

// One layout at a time (PRD "Breakpoints"): desktop at 900px and wider when at least
// 540px tall; tablet at 640–899px when at least 680px tall; otherwise the Snap feed,
// which adapts to short and landscape viewports (phones in landscape, even 900px+ wide
// ones, and browser zoom). The server (and hydration) renders the layout guessed from
// the request headers (`initialLayout`: Snap for phones, else desktop). feed.css hides
// the guessed tree wherever it is not the viewport's layout and shows that layout's
// skeleton instead until the client switches, so a wrong guess never flashes the wrong layout.
// The shell (shell.css) shows its rail under the same desktop condition.
// Keep these in step with feed.css and components/feed/feed-skeleton.tsx.
type Layout = FeedLayout
const QUERIES = ["(width >= 900px) and (height >= 540px)", "(width >= 640px) and (height >= 680px)"]
const subscribeLayout = (cb: () => void) => {
  const ms = QUERIES.map((q) => matchMedia(q))
  ms.forEach((m) => m.addEventListener("change", cb))
  return () => ms.forEach((m) => m.removeEventListener("change", cb))
}
const currentLayout = (): Layout =>
  matchMedia(QUERIES[0]).matches ? "desktop" : matchMedia(QUERIES[1]).matches ? "tablet" : "phone"
/** true for the server render and hydration, false once the client has taken over. */
const noSubscribe = () => () => {}
const useHydrating = () => useSyncExternalStore(noSubscribe, () => false, () => true)

/**
 * Flip Wander farther: save the setting and nothing else. The cards on screen stay; the next
 * Load more generates with the saved value (#205). Never rejects (a failed save toasts and rolls back).
 */
export function flipWander(on: boolean, save: (next: boolean) => Promise<void>): Promise<void> {
  return save(!on).catch(() => {
    toast.error("Couldn't save Wander farther")
  })
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function FeedClient({ recommendations, musicPlatform, signalCount, initialAdventurous = false, initialLayout = "phone" }: FeedClientProps) {
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
  // The server snapshot is used for SSR and for hydration, so both render `initialLayout`.
  const layout = useSyncExternalStore(subscribeLayout, currentLayout, () => initialLayout)
  const hydrating = useHydrating()
  // The layout whose tree is mounted and showing (set by the layout itself); until it is the
  // current one (a layout's chunk still loading) the keyboard shortcuts stay inert.
  const [shown, setShown] = useState<Layout | null>(null)
  const mounted = shown !== null
  // After the page's load event (artwork, fonts) and then when the browser is idle.
  useEffect(() => {
    if (!mounted) return
    let idle = 0
    let timer = 0
    const schedule = () => {
      if (typeof requestIdleCallback === "function") idle = requestIdleCallback(preloadLayouts, { timeout: 5000 })
      else timer = window.setTimeout(preloadLayouts, 2000) // Safari before 18 has no requestIdleCallback
    }
    if (document.readyState === "complete") schedule()
    else window.addEventListener("load", schedule, { once: true })
    return () => {
      window.removeEventListener("load", schedule)
      if (idle) cancelIdleCallback(idle)
      clearTimeout(timer)
    }
  }, [mounted])

  const { adventurous, setAdventurous } = useAdventurousMode(initialAdventurous)
  // A Load more right after a flip waits for the save, so it generates with the new value.
  const wanderSave = useRef<Promise<void>>(Promise.resolve())
  const wander = { on: adventurous, toggle: () => void (wanderSave.current = flipWander(adventurous, setAdventurous)) }

  async function handleGenerateMore() {
    await wanderSave.current
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
      <FeedShortcuts triage={triage} enabled={shown === layout} />
      {/* Server render and hydration: where CSS hides the guessed tree (the guess doesn't match the
          viewport), the skeleton for the viewport shows in its place (feed.css, .ev-guess-skel).
          The client's first render replaces it with the right layout or that layout's loading
          skeleton, which draws the same frame. */}
      {hydrating && (
        <div className="ev-guess-skel" data-guess={initialLayout}>
          <FeedSkeleton />
        </div>
      )}
      <View triage={triage} signalCount={signalCount} onLoadMore={handleGenerateMore} generating={isGenerating} wander={wander} onShown={setShown} />
    </>
  )
}
