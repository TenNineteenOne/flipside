"use client"

import { Suspense, use, useMemo } from "react"
import { RefreshCw, Sparkles, Moon, Mountain, Flame, Dices, type LucideIcon } from "lucide-react"
import { AnimatePresence } from "framer-motion"
import "./explore.css"
import { ChallengeCard, ChallengeSkeleton } from "@/components/explore/challenge-card"
import { SkeletonCard } from "@/components/explore/skeleton-card"
import { ExploreArtistRow } from "@/components/explore/explore-artist-row"
import type { RailKey, RailPayload } from "@/lib/cards/explore-rail-payloads"
import type { MusicPlatform } from "@/lib/music-links"
import { useArtistFeedback } from "@/lib/hooks/use-artist-feedback"
import { useArtistSaves } from "@/lib/hooks/use-artist-saves"
import { useRailSession } from "@/lib/hooks/use-rail-session"

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

// Rail identity icon. Module-scope so it isn't rebuilt per render.
const RAIL_ICON: Record<RailKey, LucideIcon> = {
  adjacent: Moon,
  outside: Mountain,
  wildcards: Flame,
  leftfield: Dices,
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
  // Rails, active rail, adventurous ordering, shuffle / apply rebuilds and the
  // poll-swap all live in the RailSession controller (lib/client/rail-session).
  const {
    adventurous,
    orderedRails,
    activeKey,
    activeRail,
    isRegenerating,
    isTogglingAdv,
    isAdvDirty,
    isApplyingAdv,
    select: setActiveKey,
    toggleAdventurous: handleAdventurousToggle,
    shuffle: handleShuffle,
    applyAdventurous: handleApplyAdventurous,
  } = useRailSession({
    initialRails,
    initialGeneratedAt,
    initialAdventurous,
    coldStart,
    // Shuffle drops stale thumbs_up on the active rail before the swap.
    dropThumbsUp: (ids) =>
      setSignals((prev) => {
        let changed = false
        const n = new Map(prev)
        for (const id of ids) {
          if (n.get(id) === "thumbs_up") {
            n.delete(id)
            changed = true
          }
        }
        return changed ? n : prev
      }),
    // Applying an Adventurous change rebuilds every rail — drop all signals.
    clearSignals: () => setSignals(new Map()),
  })

  // Feedback signals (thumbs_up / thumbs_down / skip) per artist.
  // railKey lets the server narrow-invalidate only the owning rail; other
  // rails pick up the signal on their own TTL via the persisted feedback row.
  // "skip" is local-only — no server call, no recommendation_cache write.
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

  const totalDiscoveries = useMemo(
    () => orderedRails.reduce((n, r) => n + r.artists.length, 0),
    [orderedRails],
  )

  const building = orderedRails.length === 0 && isRegenerating

  return (
    <div className="ev-explore shell-wide" data-adventurous={adventurous || undefined}>
      <header className="ex-head">
        <div>
          <h1 className="ex-title">Explore</h1>
          <p className="ex-lede">Artists further out from your usual, in rails you can shuffle whenever you like.</p>
        </div>
        <p className="ex-tally">
          <strong>{totalDiscoveries}</strong> discoveries
          {adventurous && <span className="ex-tally-adv"> · Adventurous on</span>}
        </p>
      </header>

      <div className="ex-controls">
        <button
          type="button"
          className="ex-adv"
          onClick={handleAdventurousToggle}
          disabled={isTogglingAdv}
          aria-pressed={adventurous}
        >
          <span className="ex-switch" aria-hidden>
            <span />
          </span>
          <span className="ex-adv-text">
            <span className="ex-adv-label">Adventurous mode</span>
            <span className="ex-adv-hint">
              {isAdvDirty
                ? "Apply your Adventurous change to get fresh picks."
                : adventurous
                  ? "Serendipity up top. Left-field inflated. Expect unfamiliar."
                  : "Bias the mix toward serendipity and left-field picks."}
            </span>
          </span>
        </button>
        {(isAdvDirty || activeRail) && (
          <div className="ex-actions">
            {isAdvDirty && (
              <button
                type="button"
                onClick={handleApplyAdventurous}
                disabled={isApplyingAdv}
                aria-label="Rebuild Explore rails to apply Adventurous mode change"
                className="ex-btn ex-btn-primary"
              >
                <RefreshCw size={16} className={isApplyingAdv ? "ex-spin" : undefined} aria-hidden />
                {isApplyingAdv ? "Rebuilding\u2026" : `Rebuild rails with Adventurous ${adventurous ? "on" : "off"}`}
              </button>
            )}
            {activeRail && (
              <button
                type="button"
                onClick={handleShuffle}
                disabled={isRegenerating}
                aria-label={`Shuffle ${activeRail.title}`}
                className="ex-btn ex-btn-ghost"
              >
                <RefreshCw size={16} className={isRegenerating ? "ex-spin" : undefined} aria-hidden />
                {isRegenerating ? "Shuffling…" : "Shuffle"}
              </button>
            )}
          </div>
        )}
      </div>

      <Suspense fallback={<ChallengeSkeleton />}>
        <ChallengeSlot challengePromise={challengePromise} adventurous={adventurous} />
      </Suspense>

      {orderedRails.length > 0 && (
        <nav className="ex-tabs" aria-label="Explore rails">
          {orderedRails.map((rail) => {
            const Icon = RAIL_ICON[rail.railKey]
            return (
              <button
                key={rail.railKey}
                type="button"
                className="ex-tab"
                aria-pressed={rail.railKey === activeKey}
                onClick={() => setActiveKey(rail.railKey)}
              >
                <Icon size={15} aria-hidden />
                <span>{rail.title}</span>
                <span className="ex-tab-n">{rail.artists.length}</span>
              </button>
            )
          })}
        </nav>
      )}

      {orderedRails.length === 0 && (
        <div className="ex-empty" role="status">
          {isRegenerating ? (
            <>
              <p className="ex-empty-title">Building your exploration rails…</p>
              <p>This takes about a minute. Rails will appear automatically when ready.</p>
              <span className="ex-empty-bar" aria-hidden>
                <span />
              </span>
            </>
          ) : (
            <>
              <p className="ex-empty-title">Not enough signal yet</p>
              <p>Save a few artists or mark some thumbs-up in your feed, then shuffle to generate richer rails here.</p>
            </>
          )}
        </div>
      )}

      {building && (
        <div className="ex-grid ex-building" aria-hidden>
          {[0, 1, 2].map((i) => (
            <SkeletonCard key={i} />
          ))}
        </div>
      )}

      {activeRail && (
        <section aria-labelledby="ex-rail-title">
          <div className="ex-rail-head">
            <h2 id="ex-rail-title" className="ex-rail-title">{activeRail.title}</h2>
            {/* The Adventurous note shares the subtitle's line (reserved in the skeleton, explore.css). */}
            <p className="ex-rail-sub">
              {activeRail.subtitle}
              {adventurous && " "}
              {adventurous && (
                <span className="ex-rail-adv">
                  <Sparkles size={13} aria-hidden /> Adventurous order: furthest-out rails first
                </span>
              )}
            </p>
          </div>

          {activeRail.artists.length === 0 ? (
            <div className="ex-empty">
              <p>{activeRail.emptyCaption ?? "Nothing here yet — tap Shuffle."}</p>
            </div>
          ) : (
            <div className="ex-grid">
              <AnimatePresence initial={false}>
                {activeRail.artists.map((artist) => (
                  <ExploreArtistRow
                    key={artist.id}
                    artist={artist}
                    musicPlatform={musicPlatform}
                    isSaved={savedIds.has(artist.id)}
                    dismissSignal={dismissedSignals.get(artist.id) ?? null}
                    onSave={toggleSave}
                    onFeedback={setSignal}
                  />
                ))}
              </AnimatePresence>
            </div>
          )}
        </section>
      )}
    </div>
  )
}
