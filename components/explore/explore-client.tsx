"use client"

import { useCallback, useMemo, useRef, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { RefreshCw, Sparkles, Moon, Mountain, Flame, Dices, type LucideIcon } from "lucide-react"
import { AnimatePresence } from "framer-motion"
import { ChallengeCard } from "@/components/explore/challenge-card"
import { ExploreArtistRow } from "@/components/explore/explore-artist-row"
import type { RailArtist } from "@/components/explore/rail"
import type { MusicPlatform } from "@/lib/music-links"
import { Ambient } from "@/components/visual/ambient"
import { createKeyedSerializer } from "@/lib/keyed-serializer"

export interface ChallengePayload {
  title: string
  description: string
  progress: number
  target: number
  completed: boolean
}

export type RailKey = "adjacent" | "outside" | "wildcards" | "leftfield"

export interface RailPayload {
  railKey: RailKey
  title: string
  subtitle: string
  artists: RailArtist[]
  emptyCaption?: string
}

export interface ExploreClientProps {
  rails: RailPayload[]
  musicPlatform: MusicPlatform
  adventurous: boolean
  initialSavedIds: string[]
  challenge: ChallengePayload | null
}

export function ExploreClient({
  rails,
  musicPlatform,
  adventurous: initialAdventurous,
  initialSavedIds,
  challenge,
}: ExploreClientProps) {
  const router = useRouter()
  const [, startTransition] = useTransition()
  const [dismissedSignals, setDismissedSignals] = useState<Map<string, string>>(new Map())
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set(initialSavedIds))
  const saveQueueRef = useRef(createKeyedSerializer())
  const [isRegenerating, setIsRegenerating] = useState(false)
  const [adventurous, setAdventurous] = useState(initialAdventurous)
  const [isTogglingAdv, setIsTogglingAdv] = useState(false)
  const [isAdvDirty, setIsAdvDirty] = useState(false)
  const [isApplyingAdv, setIsApplyingAdv] = useState(false)

  async function handleAdventurousToggle() {
    if (isTogglingAdv) return
    const next = !adventurous
    setAdventurous(next)
    setIsTogglingAdv(true)
    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ adventurous: next }),
      })
      if (!res.ok) throw new Error("server")
      try {
        localStorage.setItem("flipside.adventurous", next ? "1" : "0")
        window.dispatchEvent(new Event("flipside:adventurous-change"))
      } catch { /* noop */ }
      setIsAdvDirty(true)
    } catch {
      setAdventurous(!next)
      toast.error("Couldn't toggle — try again")
    } finally {
      setIsTogglingAdv(false)
    }
  }

  async function handleApplyAdventurous() {
    if (!isAdvDirty || isApplyingAdv) return
    setIsApplyingAdv(true)
    try {
      const res = await fetch("/api/explore/generate?force=true", { method: "POST" })
      if (!res.ok) throw new Error("generate failed")
      setDismissedSignals(new Map())
      setIsAdvDirty(false)
      startTransition(() => router.refresh())
    } catch {
      toast.error("Couldn't rebuild — try again")
    } finally {
      setIsApplyingAdv(false)
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
  const activeRail = orderedRails.find((r) => r.railKey === activeKey) ?? orderedRails[0]

  const handleFeedback = useCallback(async (artistId: string, signal: string) => {
    setDismissedSignals((prev) => new Map(prev).set(artistId, signal))
    // "skip" is local-only in Explore — no server call, no recommendation_cache write.
    if (signal !== "thumbs_up" && signal !== "thumbs_down") return
    try {
      const res = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // railKey lets the server narrow-invalidate only the owning rail; other
        // rails pick up the signal on their own TTL via the persisted feedback row.
        body: JSON.stringify({ spotifyArtistId: artistId, signal, railKey: activeKey }),
      })
      if (!res.ok) throw new Error("server")
    } catch {
      setDismissedSignals((prev) => {
        const n = new Map(prev)
        n.delete(artistId)
        return n
      })
      toast.error("Couldn't save feedback — try again")
    }
  }, [activeKey])

  const handleSave = useCallback(async (artistId: string) => {
    const isCurrentlySaved = savedIds.has(artistId)
    setSavedIds((prev) => {
      const n = new Set(prev)
      if (isCurrentlySaved) n.delete(artistId)
      else n.add(artistId)
      return n
    })
    // Serialize per-artist so rapid save/unsave clicks hit the server in
    // click order and don't leave the saves row out of sync with intent.
    return saveQueueRef.current(artistId, async () => {
      try {
        const res = await fetch("/api/saves", {
          method: isCurrentlySaved ? "DELETE" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ spotifyArtistId: artistId }),
        })
        if (!res.ok) throw new Error("server")
        if (!isCurrentlySaved) {
          setDismissedSignals((prev) => new Map(prev).set(artistId, "saved"))
        }
      } catch {
        setSavedIds((prev) => {
          const n = new Set(prev)
          if (isCurrentlySaved) n.add(artistId)
          else n.delete(artistId)
          return n
        })
        toast.error(isCurrentlySaved ? "Couldn't unsave — try again" : "Couldn't save — try again")
      }
    })
  }, [savedIds])

  async function handleShuffle() {
    if (isRegenerating) return
    setIsRegenerating(true)
    try {
      const res = await fetch("/api/explore/generate?force=true", { method: "POST" })
      if (!res.ok) throw new Error("generate failed")
      // Clear dismissed for the active tab's artists so a fresh roll isn't hidden.
      setDismissedSignals((prev) => {
        if (!activeRail) return prev
        const n = new Map(prev)
        for (const a of activeRail.artists) n.delete(a.id)
        return n
      })
      startTransition(() => router.refresh())
    } catch {
      toast.error("Couldn't shuffle — try again")
    } finally {
      setIsRegenerating(false)
    }
  }

  const totalDiscoveries = orderedRails.reduce((n, r) => n + r.artists.length, 0)

  // Rail identity — icon + accent color
  const RAIL_META: Record<RailKey, { icon: LucideIcon; rgb: string }> = {
    adjacent:  { icon: Moon,     rgb: "129, 140, 248" },  // indigo (After hours)
    outside:   { icon: Mountain, rgb: "139, 92, 246" },   // violet
    wildcards: { icon: Flame,    rgb: "245, 176, 71" },   // amber
    leftfield: { icon: Dices,    rgb: "236, 111, 181" },  // magenta
  }
  const activeAccentRgb = activeRail ? RAIL_META[activeRail.railKey].rgb : "139, 92, 246"

  // OFF — rail color dominant, rainbow whisper. Two large rail-color anchors
  // drive the page mood; two small warm hints (amber + magenta) keep it from
  // feeling monochromatic.
  const palette = `
    radial-gradient(75% 60% at 18% 14%, rgba(${activeAccentRgb}, 0.40) 0%, transparent 70%),
    radial-gradient(55% 48% at 84% 26%, rgba(${activeAccentRgb}, 0.30) 0%, transparent 72%),
    radial-gradient(40% 32% at 50% 92%, rgba(255,138,46,0.14) 0%, transparent 75%),
    radial-gradient(38% 30% at 10% 86%, rgba(236,111,181,0.14) 0%, transparent 72%)
  `

  // ON — rainbow sunset takes the lead, rail color is one of many voices.
  // The warm amber/hot-pink/coral glow dominates; rail tints the bottom.
  const adventurousPalette = `
    radial-gradient(65% 50% at 18% 10%, rgba(255,138,46,0.40) 0%, transparent 72%),
    radial-gradient(58% 48% at 85% 26%, rgba(255,74,130,0.36) 0%, transparent 72%),
    radial-gradient(60% 48% at 50% 92%, rgba(${activeAccentRgb}, 0.32) 0%, transparent 75%),
    radial-gradient(50% 40% at 10% 86%, rgba(255,184,92,0.28) 0%, transparent 72%)
  `

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

      <style>{`@keyframes adv-apply-pulse {
        0%, 100% { box-shadow: 0 0 20px rgba(245,176,71,0.18); }
        50%      { box-shadow: 0 0 36px rgba(245,176,71,0.36); }
      }`}</style>

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

      {challenge && (
        <ChallengeCard
          title={challenge.title}
          description={challenge.description}
          progress={challenge.progress}
          target={challenge.target}
          completed={challenge.completed}
          adventurous={adventurous}
        />
      )}

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
