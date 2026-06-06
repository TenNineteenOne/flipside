"use client"

import { Suspense, use, useCallback, useEffect, useMemo, useRef, useState } from "react"
import { toast } from "sonner"
import { RefreshCw, Sparkles, Moon, Mountain, Flame, Dices, type LucideIcon } from "lucide-react"
import { AnimatePresence } from "framer-motion"
import { ChallengeCard } from "@/components/explore/challenge-card"
import { ExploreArtistRow } from "@/components/explore/explore-artist-row"
import type { RailArtist } from "@/components/explore/rail"
import type { MusicPlatform } from "@/lib/music-links"
import { Ambient } from "@/components/visual/ambient"
import { useAdventurousMode } from "@/lib/hooks/use-adventurous-mode"
import { useArtistFeedback } from "@/lib/hooks/use-artist-feedback"
import { useArtistSaves } from "@/lib/hooks/use-artist-saves"

// ---------------------------------------------------------------------------
// Poll-swap helpers — pure functions, exported for unit tests
// ---------------------------------------------------------------------------

/** True when `latest` is strictly after `captured`, meaning the regen landed. */
export function hasRegenCompleted(
  captured: string | null,
  latest: string | null,
): boolean {
  if (latest === null) return false
  if (captured === null) return true // first paint was cold; any value is new
  return new Date(latest) > new Date(captured)
}

/**
 * The ceiling (ms) after which the poller gives up and shows a soft toast.
 * Regen takes 54-74s; 90s ceiling gives comfortable headroom.
 */
export const POLL_CEILING_MS = 90_000

/** Polling cadence (ms). */
export const POLL_INTERVAL_MS = 2_500

export interface ChallengePayload {
  title: string
  description: string
  progress: number
  target: number
  completed: boolean
}

// Streams the challenge card without blocking rails. Receives a promise from
// the server; React 19's `use` hook unwraps it. Wrapped in <Suspense fallback=
// {null}> so rails render first and the challenge appears fractionally later.
function ChallengeSlot({
  challengePromise,
  adventurous,
}: {
  challengePromise: Promise<ChallengePayload | null>
  adventurous: boolean
}) {
  const challenge = use(challengePromise)
  if (!challenge) return null
  return (
    <ChallengeCard
      title={challenge.title}
      description={challenge.description}
      progress={challenge.progress}
      target={challenge.target}
      completed={challenge.completed}
      adventurous={adventurous}
    />
  )
}

export type RailKey = "adjacent" | "outside" | "wildcards" | "leftfield"

export interface RailPayload {
  railKey: RailKey
  title: string
  subtitle: string
  artists: RailArtist[]
  emptyCaption?: string
}

// Rail identity — icon + accent color. Module-scope so it isn't rebuilt per render.
const RAIL_META: Record<RailKey, { icon: LucideIcon; rgb: string }> = {
  adjacent:  { icon: Moon,     rgb: "129, 140, 248" },  // indigo (After hours)
  outside:   { icon: Mountain, rgb: "139, 92, 246" },   // violet
  wildcards: { icon: Flame,    rgb: "245, 176, 71" },   // amber
  leftfield: { icon: Dices,    rgb: "236, 111, 181" },  // magenta
}

export interface ExploreClientProps {
  rails: RailPayload[]
  musicPlatform: MusicPlatform
  adventurous: boolean
  initialSavedIds: string[]
  challengePromise: Promise<ChallengePayload | null>
  /** ISO timestamp of the most-recent cache write; null when cold. */
  generatedAt?: string | null
  /** True when the page painted with no cached rails (cold start). */
  coldStart?: boolean
}

export function ExploreClient({
  rails: initialRails,
  musicPlatform,
  adventurous: initialAdventurous,
  initialSavedIds,
  challengePromise,
  generatedAt: initialGeneratedAt = null,
  coldStart = false,
}: ExploreClientProps) {
  const [rails, setRails] = useState<RailPayload[]>(initialRails)
  const [isRegenerating, setIsRegenerating] = useState(false)
  const { adventurous, setAdventurous } = useAdventurousMode(initialAdventurous)
  const [isTogglingAdv, setIsTogglingAdv] = useState(false)
  const [isAdvDirty, setIsAdvDirty] = useState(false)
  const [isApplyingAdv, setIsApplyingAdv] = useState(false)

  async function handleAdventurousToggle() {
    if (isTogglingAdv) return
    setIsTogglingAdv(true)
    try {
      await setAdventurous(!adventurous)
      setIsAdvDirty(true)
    } catch {
      toast.error("Couldn't toggle — try again")
    } finally {
      setIsTogglingAdv(false)
    }
  }

  // Adventurous rail ordering — default-off order is adjacent/wildcards/outside/leftfield.
  // When ON, flip to serendipity-first: outside/leftfield/wildcards/adjacent. The server
  // also inflates Left-field count when Adventurous is set. Rails with fewer than
  // MIN_PICKS artists are hidden so every visible tab has real depth to browse.
  const orderedRails = useMemo(() => {
    const MIN_PICKS = 5
    const order: RailKey[] = adventurous
      ? ["outside", "leftfield", "wildcards", "adjacent"]
      : ["adjacent", "wildcards", "outside", "leftfield"]
    const byKey = new Map(rails.map((r) => [r.railKey, r] as const))
    return order
      .map((k) => byKey.get(k))
      .filter((r): r is RailPayload => !!r && r.artists.length >= MIN_PICKS)
  }, [rails, adventurous])

  const [activeKey, setActiveKey] = useState<RailKey>(orderedRails[0]?.railKey ?? "adjacent")
  const activeRail = useMemo(
    () => orderedRails.find((r) => r.railKey === activeKey) ?? orderedRails[0],
    [orderedRails, activeKey],
  )

  // Feedback signals (thumbs_up / thumbs_down / skip) per artist.
  // railKey lets the server narrow-invalidate only the owning rail; other
  // rails pick up the signal on their own TTL via the persisted feedback row.
  // "skip" is local-only — no server call, no recommendation_cache write.
  // setSignals exposes bulk replacement so handleShuffle / handleApplyAdventurous
  // can drop stale thumbs_up entries without triggering individual setSignal calls.
  const { signals: dismissedSignals, setSignal, setSignals } = useArtistFeedback({
    railKey: activeKey,
    // Explore treats "skip" as a session-local dismiss — no /api/feedback
    // POST, no recommendation_cache write. Feed does NOT pass this option, so
    // feed continues to POST "skip" (which writes a feedback row via
    // rpc_record_feedback, matching the surface's original behavior).
    localOnlySignals: ["skip"],
    errorMessages: {
      undoFailed: "Couldn't undo — try again",
      saveFailed: "Couldn't save feedback — try again",
    },
  })

  // Saved-artist IDs. Serialization and rollback are handled inside the hook.
  const { savedIds, toggleSave } = useArtistSaves({
    initialSavedIds,
    errorMessages: {
      saveFailed: "Couldn't save — try again",
      unsaveFailed: "Couldn't unsave — try again",
    },
  })

  const handleFeedback = useCallback(
    (artistId: string, signal: string) => setSignal(artistId, signal),
    [setSignal],
  )

  const handleSave = useCallback(
    (artistId: string) => toggleSave(artistId),
    [toggleSave],
  )

  // -------------------------------------------------------------------------
  // Poll-swap machinery
  // -------------------------------------------------------------------------

  // Ref holding the latest generatedAt we've seen — updated whenever rails swap
  // in. Using a ref rather than state so poll callbacks capture the latest
  // value without needing to be recreated each render.
  const generatedAtRef = useRef<string | null>(initialGeneratedAt)
  // Pointer to the active interval so we can clear it from anywhere.
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  // Absolute deadline so we don't poll forever.
  const pollDeadlineRef = useRef<number>(0)
  // Ref to the latest orderedRails so poll callbacks can drop thumbs_up without
  // stale closure issues. Declared here (before regenAndPoll) so the closure
  // sees it during regen calls.
  const orderedRailsRef = useRef(orderedRails)

  function stopPolling() {
    if (pollTimerRef.current !== null) {
      clearInterval(pollTimerRef.current)
      pollTimerRef.current = null
    }
  }

  /**
   * Fetch the latest rails from GET /api/explore/rails and swap them in when
   * the generatedAt timestamp has advanced. Returns true if the swap landed.
   * Never throws — network/parse errors are silently skipped so the poller
   * stays alive until the ceiling.
   */
  async function pollOnce(captured: string | null): Promise<boolean> {
    try {
      const res = await fetch("/api/explore/rails")
      if (!res.ok) return false
      const json = await res.json() as { rails: RailPayload[]; generatedAt: string | null }
      if (!hasRegenCompleted(captured, json.generatedAt)) return false
      // Regen landed — swap rails in.
      generatedAtRef.current = json.generatedAt
      setRails(json.rails)
      // Preserve activeKey if the refreshed rails contain it; otherwise fall
      // back to whatever orderedRails[0] will resolve to after state update.
      setActiveKey((prev) => {
        const keys = new Set(json.rails.map((r: RailPayload) => r.railKey))
        return keys.has(prev) ? prev : (json.rails[0]?.railKey ?? "adjacent")
      })
      return true
    } catch {
      // Swallow — next tick will retry
      return false
    }
  }

  /**
   * Kick off a background regen then poll until rails swap in (or ceiling).
   * `onSettle` is called (no-arg) when the poller stops, regardless of reason.
   * `dropThumbsUp` — when true, clears thumbs_up entries from the current
   * active rail's artists before the swap (used by handleShuffle).
   */
  async function regenAndPoll(opts: {
    onSettle: () => void
    dropThumbsUp?: boolean
    clearAdvDirty?: boolean
  }) {
    try {
      const res = await fetch("/api/explore/generate?force=true", { method: "POST" })
      if (!res.ok) throw new Error("generate failed")
    } catch {
      toast.error("Couldn't start rebuild — try again")
      opts.onSettle()
      return
    }

    // Capture the timestamp AFTER the POST so we don't prematurely accept
    // a stale cache row that was written before the regen started.
    const captured = generatedAtRef.current

    if (opts.dropThumbsUp) {
      setSignals((prev) => {
        const active = orderedRailsRef.current?.[0]
        if (!active) return prev
        let changed = false
        const n = new Map(prev)
        for (const a of active.artists) {
          if (n.get(a.id) === "thumbs_up") {
            n.delete(a.id)
            changed = true
          }
        }
        return changed ? n : prev
      })
    }

    if (opts.clearAdvDirty) {
      setSignals(new Map())
      setIsAdvDirty(false)
    }

    stopPolling()
    pollDeadlineRef.current = Date.now() + POLL_CEILING_MS

    pollTimerRef.current = setInterval(async () => {
      const expired = Date.now() >= pollDeadlineRef.current
      if (expired) {
        stopPolling()
        opts.onSettle()
        toast("Still building — refresh in a moment", { duration: 4000 })
        return
      }
      const swapped = await pollOnce(captured)
      if (swapped) {
        stopPolling()
        opts.onSettle()
      }
    }, POLL_INTERVAL_MS)
  }

  // Cleanup on unmount
  useEffect(() => () => { stopPolling() }, [])

  // Cold-start: on mount, if coldStart is true, kick off a regen+poll so the
  // page populates without ever having blocked the server render.
  // We use a ref to ensure this fires at most once even in StrictMode.
  const coldStartFiredRef = useRef(false)
  useEffect(() => {
    if (!coldStart || coldStartFiredRef.current) return
    coldStartFiredRef.current = true
    setIsRegenerating(true)
    regenAndPoll({
      onSettle: () => setIsRegenerating(false),
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coldStart])

  // Keep orderedRailsRef current on every render.
  useEffect(() => { orderedRailsRef.current = orderedRails }, [orderedRails])

  async function handleApplyAdventurous() {
    if (!isAdvDirty || isApplyingAdv) return
    setIsApplyingAdv(true)
    await regenAndPoll({
      clearAdvDirty: true,
      onSettle: () => setIsApplyingAdv(false),
    })
  }

  async function handleShuffle() {
    if (isRegenerating) return
    setIsRegenerating(true)
    await regenAndPoll({
      dropThumbsUp: true,
      onSettle: () => setIsRegenerating(false),
    })
  }

  const totalDiscoveries = useMemo(
    () => orderedRails.reduce((n, r) => n + r.artists.length, 0),
    [orderedRails],
  )

  const activeAccentRgb = activeRail ? RAIL_META[activeRail.railKey].rgb : "139, 92, 246"

  // OFF — rail color dominant, rainbow whisper. Two large rail-color anchors
  // drive the page mood; two small warm hints (amber + magenta) keep it from
  // feeling monochromatic.
  const palette = useMemo(
    () => `
    radial-gradient(75% 60% at 18% 14%, rgba(${activeAccentRgb}, 0.40) 0%, transparent 70%),
    radial-gradient(55% 48% at 84% 26%, rgba(${activeAccentRgb}, 0.30) 0%, transparent 72%),
    radial-gradient(40% 32% at 50% 92%, rgba(255,138,46,0.14) 0%, transparent 75%),
    radial-gradient(38% 30% at 10% 86%, rgba(236,111,181,0.14) 0%, transparent 72%)
  `,
    [activeAccentRgb],
  )

  // ON — rainbow sunset takes the lead, rail color is one of many voices.
  // The warm amber/hot-pink/coral glow dominates; rail tints the bottom.
  const adventurousPalette = useMemo(
    () => `
    radial-gradient(65% 50% at 18% 10%, rgba(255,138,46,0.40) 0%, transparent 72%),
    radial-gradient(58% 48% at 85% 26%, rgba(255,74,130,0.36) 0%, transparent 72%),
    radial-gradient(60% 48% at 50% 92%, rgba(${activeAccentRgb}, 0.32) 0%, transparent 75%),
    radial-gradient(50% 40% at 10% 86%, rgba(255,184,92,0.28) 0%, transparent 72%)
  `,
    [activeAccentRgb],
  )

  return (
    <div>
      <Ambient palette={palette} adventurousPalette={adventurousPalette} adventurous={adventurous} />

      <div className="page-head">
        <h1>Explore</h1>
        <span className="sub">
          {totalDiscoveries} discoveries
          {adventurous ? " · Adventurous on" : ""}
        </span>
      </div>

      <button
        type="button"
        onClick={handleAdventurousToggle}
        disabled={isTogglingAdv}
        aria-pressed={adventurous}
        style={{
          position: "relative",
          overflow: "hidden",
          width: "100%",
          padding: "18px 20px",
          marginBottom: 16,
          textAlign: "left",
          borderRadius: 18,
          border: adventurous
            ? "1px solid rgba(245,176,71,0.35)"
            : "1px solid rgba(255,255,255,0.08)",
          background: adventurous
            ? "linear-gradient(135deg, rgba(245,176,71,0.22) 0%, rgba(236,111,181,0.18) 40%, rgba(125,217,198,0.14) 75%, rgba(168,199,250,0.12) 100%)"
            : "rgba(15,15,15,0.55)",
          backdropFilter: "blur(18px)",
          WebkitBackdropFilter: "blur(18px)",
          color: "var(--text-primary)",
          cursor: isTogglingAdv ? "default" : "pointer",
          opacity: isTogglingAdv ? 0.75 : 1,
          transition: "background 0.3s, border-color 0.3s",
          display: "flex",
          alignItems: "center",
          gap: 16,
        }}
      >
        {adventurous && (
          <div
            aria-hidden
            style={{
              position: "absolute",
              inset: 0,
              pointerEvents: "none",
              background: `
                radial-gradient(3px 3px at 18% 28%, rgba(255,255,255,0.7), transparent 70%),
                radial-gradient(2px 2px at 72% 22%, rgba(255,255,255,0.5), transparent 70%),
                radial-gradient(2px 2px at 42% 78%, rgba(255,255,255,0.55), transparent 70%),
                radial-gradient(3px 3px at 88% 68%, rgba(255,255,255,0.6), transparent 70%)
              `,
            }}
          />
        )}
        <div
          style={{
            width: 42,
            height: 42,
            borderRadius: 14,
            background: adventurous
              ? "rgba(255,255,255,0.14)"
              : "rgba(139,92,246,0.14)",
            border: adventurous
              ? "1px solid rgba(255,255,255,0.2)"
              : "1px solid rgba(139,92,246,0.3)",
            display: "grid",
            placeItems: "center",
            color: adventurous ? "#fff" : "var(--accent)",
            flexShrink: 0,
          }}
        >
          <Sparkles size={18} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontSize: 18,
              fontWeight: 600,
              lineHeight: 1.15,
              color: adventurous ? "#fff" : "var(--text-primary)",
            }}
          >
            {adventurous ? "Adventurous mode — on" : "Adventurous mode"}
          </div>
          <div
            style={{
              fontSize: 12.5,
              color: adventurous ? "rgba(255,255,255,0.8)" : "var(--text-muted)",
              marginTop: 4,
              lineHeight: 1.4,
            }}
          >
            {adventurous
              ? "Serendipity up top. Left-field inflated. Expect unfamiliar."
              : "Bias the mix toward serendipity and left-field picks."}
          </div>
        </div>
        <div
          aria-hidden
          style={{
            width: 40,
            height: 24,
            borderRadius: 999,
            background: adventurous ? "rgba(255,255,255,0.85)" : "rgba(255,255,255,0.08)",
            border: "1px solid " + (adventurous ? "rgba(255,255,255,0.6)" : "rgba(255,255,255,0.12)"),
            position: "relative",
            flexShrink: 0,
            transition: "background 0.25s",
          }}
        >
          <div
            style={{
              position: "absolute",
              top: 2,
              left: adventurous ? 18 : 2,
              width: 18,
              height: 18,
              borderRadius: "50%",
              background: adventurous ? "#f5b047" : "rgba(255,255,255,0.6)",
              transition: "left 0.25s, background 0.25s",
            }}
          />
        </div>
      </button>

      {isAdvDirty && (
        <button
          type="button"
          onClick={handleApplyAdventurous}
          disabled={isApplyingAdv}
          aria-label="Rebuild Explore rails to apply Adventurous mode change"
          className="adv-apply-cta"
          style={{
            position: "relative",
            overflow: "hidden",
            width: "100%",
            padding: "14px 20px",
            marginBottom: 16,
            textAlign: "left",
            borderRadius: 18,
            border: "1px solid rgba(245,176,71,0.45)",
            background: "linear-gradient(135deg, rgba(245,176,71,0.28) 0%, rgba(236,111,181,0.24) 45%, rgba(125,217,198,0.18) 80%, rgba(168,199,250,0.16) 100%)",
            backdropFilter: "blur(18px)",
            WebkitBackdropFilter: "blur(18px)",
            color: "#fff",
            cursor: isApplyingAdv ? "default" : "pointer",
            opacity: isApplyingAdv ? 0.75 : 1,
            display: "flex",
            alignItems: "center",
            gap: 14,
            animation: isApplyingAdv ? undefined : "adv-apply-pulse 2s ease-in-out infinite",
            boxShadow: "0 0 28px rgba(245,176,71,0.22)",
          }}
        >
          <div
            style={{
              width: 36,
              height: 36,
              borderRadius: 12,
              background: "rgba(255,255,255,0.18)",
              border: "1px solid rgba(255,255,255,0.24)",
              display: "grid",
              placeItems: "center",
              color: "#fff",
              flexShrink: 0,
            }}
          >
            <Sparkles size={16} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 15, fontWeight: 600, lineHeight: 1.15 }}>
              {isApplyingAdv ? "Rebuilding\u2026" : `Rebuild rails with Adventurous ${adventurous ? "on" : "off"}`}
            </div>
            <div style={{ fontSize: 12, color: "rgba(255,255,255,0.8)", marginTop: 3, lineHeight: 1.4 }}>
              Apply your Adventurous change to get fresh picks.
            </div>
          </div>
          <RefreshCw size={18} style={{ opacity: 0.9, flexShrink: 0 }} />
        </button>
      )}

      <Suspense fallback={null}>
        <ChallengeSlot challengePromise={challengePromise} adventurous={adventurous} />
      </Suspense>

      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 6,
          marginTop: 16,
          marginBottom: 14,
        }}
      >
        {orderedRails.map((rail) => {
          const active = rail.railKey === activeKey
          const count = rail.artists.length
          const meta = RAIL_META[rail.railKey]
          const Icon = meta.icon
          return (
            <button
              key={rail.railKey}
              type="button"
              onClick={() => setActiveKey(rail.railKey)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                padding: "8px 14px",
                fontSize: 13,
                fontWeight: 600,
                borderRadius: 999,
                border: active ? `1px solid rgba(${meta.rgb}, 0.55)` : "1px solid var(--border)",
                background: active ? `rgba(${meta.rgb}, 0.12)` : "transparent",
                color: active ? `rgb(${meta.rgb})` : "var(--text-muted)",
                cursor: "pointer",
                transition: "background 0.15s, border-color 0.15s, color 0.15s",
              }}
            >
              <Icon size={13} />
              <span>{rail.title}</span>
              <span
                className="mono"
                style={{
                  fontSize: 11,
                  padding: "1px 7px",
                  borderRadius: 999,
                  background: active ? `rgba(${meta.rgb}, 0.25)` : "rgba(255,255,255,0.05)",
                  color: active ? `rgb(${meta.rgb})` : "var(--text-faint)",
                }}
              >
                {count}
              </span>
            </button>
          )
        })}
      </div>

      {orderedRails.length === 0 && (
        <div
          className="muted"
          style={{
            padding: "48px 18px",
            fontSize: 13,
            lineHeight: 1.5,
            textAlign: "center",
            border: "1px dashed var(--border)",
            borderRadius: 12,
            background: "rgba(15,15,15,0.45)",
          }}
        >
          <div style={{ fontWeight: 600, color: "var(--text-primary)", marginBottom: 6 }}>
            Not enough signal yet
          </div>
          Save a few artists or mark some thumbs-up in your feed, then shuffle to generate richer rails here.
        </div>
      )}

      {activeRail && (
        <div>
          <div
            style={{
              display: "flex",
              alignItems: "flex-end",
              justifyContent: "space-between",
              gap: 12,
              marginBottom: 12,
            }}
          >
            <div>
              <div className="muted" style={{ fontSize: 13, lineHeight: 1.4 }}>
                {activeRail.subtitle}
              </div>
            </div>
            <button
              type="button"
              onClick={handleShuffle}
              disabled={isRegenerating}
              aria-label={`Shuffle ${activeRail.title}`}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                padding: "8px 14px",
                fontSize: 13,
                fontWeight: 600,
                borderRadius: 8,
                background: "rgba(139,92,246,0.10)",
                border: "1px solid rgba(139,92,246,0.35)",
                color: "var(--accent)",
                cursor: isRegenerating ? "default" : "pointer",
                opacity: isRegenerating ? 0.7 : 1,
                whiteSpace: "nowrap",
              }}
            >
              <RefreshCw size={13} className={isRegenerating ? "spin" : undefined} />
              <span>{isRegenerating ? "Shuffling…" : "Shuffle"}</span>
            </button>
          </div>

          {activeRail.artists.length === 0 ? (
            <div
              className="muted"
              style={{
                padding: "36px 18px",
                fontSize: 13,
                textAlign: "center",
                border: "1px dashed var(--border)",
                borderRadius: 12,
              }}
            >
              {activeRail.emptyCaption ?? "Nothing here yet — tap Shuffle."}
            </div>
          ) : (
            <div className="col gap-16">
              <AnimatePresence initial={false}>
                {activeRail.artists.map((artist) => (
                  <ExploreArtistRow
                    key={artist.id}
                    artist={artist}
                    musicPlatform={musicPlatform}
                    isSaved={savedIds.has(artist.id)}
                    dismissSignal={dismissedSignals.get(artist.id) ?? null}
                    onSave={handleSave}
                    onFeedback={handleFeedback}
                  />
                ))}
              </AnimatePresence>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
