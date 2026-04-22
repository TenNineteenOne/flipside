"use client"

import { useState, useTransition, useMemo } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { RefreshCw } from "lucide-react"
import { AnimatePresence, motion } from "framer-motion"
import { ArtistCard } from "@/components/feed/artist-card"
import { ChallengeCard } from "@/components/explore/challenge-card"
import type { RailArtist } from "@/components/explore/rail"
import type { MusicPlatform } from "@/lib/music-links"
import type { Track } from "@/lib/music-provider/types"

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

interface ArtistWithTracks {
  id: string
  name: string
  genres: string[]
  imageUrl: string | null
  popularity: number
  topTracks: Track[]
}

interface RecommendationShape {
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

function railArtistToRecommendation(a: RailArtist): RecommendationShape {
  const sourceArtists = a.why?.sourceArtist ? [a.why.sourceArtist] : []
  const genres = a.why?.tag ? [a.why.tag] : []
  return {
    spotify_artist_id: a.id,
    artist_data: {
      id: a.id,
      name: a.name,
      genres: a.genres,
      imageUrl: a.imageUrl,
      popularity: a.popularity,
      topTracks: [],
    },
    score: 0,
    why: { sourceArtists, genres, friendBoost: [] },
    artist_color: a.artistColor ?? null,
  }
}

export function ExploreClient({
  rails,
  musicPlatform,
  adventurous,
  initialSavedIds,
  challenge,
}: ExploreClientProps) {
  const router = useRouter()
  const [, startTransition] = useTransition()
  const [dismissedSignals, setDismissedSignals] = useState<Map<string, string>>(new Map())
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set(initialSavedIds))
  const [isRegenerating, setIsRegenerating] = useState(false)

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

  async function handleFeedback(artistId: string, signal: string) {
    setDismissedSignals((prev) => new Map(prev).set(artistId, signal))
    // "skip" is local-only in Explore — no server call, no recommendation_cache write.
    if (signal !== "thumbs_up" && signal !== "thumbs_down") return
    try {
      const res = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ spotifyArtistId: artistId, signal }),
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
  }

  async function handleSave(artistId: string) {
    const isCurrentlySaved = savedIds.has(artistId)
    setSavedIds((prev) => {
      const n = new Set(prev)
      if (isCurrentlySaved) n.delete(artistId)
      else n.add(artistId)
      return n
    })
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
  }

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

  return (
    <div>
      <div className="page-head">
        <h1>Explore</h1>
        <span className="sub">
          {totalDiscoveries} discoveries
          {adventurous ? " · Adventurous on" : ""}
        </span>
      </div>

      {challenge && (
        <ChallengeCard
          title={challenge.title}
          description={challenge.description}
          progress={challenge.progress}
          target={challenge.target}
          completed={challenge.completed}
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
                border: active ? "1px solid var(--accent)" : "1px solid var(--border)",
                background: active ? "rgba(139,92,246,0.12)" : "transparent",
                color: active ? "var(--accent)" : "var(--text-muted)",
                cursor: "pointer",
                transition: "background 0.15s, border-color 0.15s, color 0.15s",
              }}
            >
              <span>{rail.title}</span>
              <span
                className="mono"
                style={{
                  fontSize: 11,
                  padding: "1px 7px",
                  borderRadius: 999,
                  background: active ? "rgba(139,92,246,0.25)" : "rgba(255,255,255,0.05)",
                  color: active ? "var(--accent)" : "var(--text-faint)",
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
                {activeRail.artists.map((artist) => {
                  const dismissSignal = dismissedSignals.get(artist.id) ?? null
                  const isDismissed = dismissSignal !== null
                  return (
                    <motion.div
                      key={artist.id}
                      layout
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0 }}
                      transition={{ type: "spring", stiffness: 400, damping: 40 }}
                    >
                      <ArtistCard
                        recommendation={railArtistToRecommendation(artist)}
                        musicPlatform={musicPlatform}
                        onSave={() => handleSave(artist.id)}
                        onFeedback={(sig) => handleFeedback(artist.id, sig)}
                        isSaved={savedIds.has(artist.id)}
                        isDismissed={isDismissed}
                        dismissSignal={dismissSignal}
                      />
                    </motion.div>
                  )
                })}
              </AnimatePresence>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
