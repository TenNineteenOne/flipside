"use client"

import { useState, useTransition, useMemo } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Rail, type RailArtist } from "@/components/explore/rail"
import { ChallengeCard } from "@/components/explore/challenge-card"
import type { MusicPlatform } from "@/lib/music-links"

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
  adventurous,
  initialSavedIds,
  challenge,
}: ExploreClientProps) {
  const router = useRouter()
  const [, startTransition] = useTransition()
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(new Set())
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set(initialSavedIds))
  const [isRegenerating, setIsRegenerating] = useState(false)

  // Adventurous rail ordering — default-off order is adjacent/wildcards/outside/leftfield.
  // When ON, flip to serendipity-first: outside/leftfield/wildcards/adjacent. The server
  // also inflates Left-field count from 6 → 12 when Adventurous is set.
  const orderedRails = useMemo(() => {
    const order: RailKey[] = adventurous
      ? ["outside", "leftfield", "wildcards", "adjacent"]
      : ["adjacent", "wildcards", "outside", "leftfield"]
    const byKey = new Map(rails.map((r) => [r.railKey, r] as const))
    return order.map((k) => byKey.get(k)).filter((r): r is RailPayload => !!r)
  }, [rails, adventurous])

  async function handleFeedback(artistId: string, signal: "thumbs_up" | "thumbs_down") {
    setDismissedIds((prev) => new Set(prev).add(artistId))
    try {
      const res = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ spotifyArtistId: artistId, signal }),
      })
      if (!res.ok) throw new Error("server")
    } catch {
      setDismissedIds((prev) => {
        const n = new Set(prev)
        n.delete(artistId)
        return n
      })
      toast.error("Couldn't save feedback — try again")
    }
  }

  async function handleSave(artistId: string) {
    const isCurrentlySaved = savedIds.has(artistId)
    // Optimistic flip
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

  async function handleRegenerate(railKey: RailKey) {
    // Individual-rail regen is not yet an endpoint — re-roll the whole set
    // (cheap: 4 rails share one Last.fm budget). Keeps scope tight for P2.1.
    if (isRegenerating) return
    setIsRegenerating(true)
    try {
      const res = await fetch("/api/explore/generate?force=true", { method: "POST" })
      if (!res.ok) throw new Error("generate failed")
      startTransition(() => router.refresh())
      void railKey
    } catch {
      toast.error("Couldn't regenerate — try again")
    } finally {
      setIsRegenerating(false)
    }
  }

  return (
    <div>
      <div className="page-head">
        <h1>Explore</h1>
        <span className="sub">
          {orderedRails.reduce((n, r) => n + r.artists.length, 0)} discoveries
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

      <div>
        {orderedRails.map((rail) => (
          <Rail
            key={rail.railKey}
            title={rail.title}
            subtitle={rail.subtitle}
            artists={rail.artists}
            musicPlatform={musicPlatform}
            onRegenerate={() => handleRegenerate(rail.railKey)}
            onFeedback={handleFeedback}
            onSave={handleSave}
            savedIds={savedIds}
            dismissedIds={dismissedIds}
            emptyCaption={rail.emptyCaption}
          />
        ))}
      </div>
    </div>
  )
}
