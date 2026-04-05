"use client"

import { useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { CheckCircle2 } from "lucide-react"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { ArtistCard } from "@/components/feed/artist-card"

interface Track {
  id: string
  name: string
  previewUrl: string | null
  durationMs: number
  albumName: string
  albumImageUrl: string | null
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
}

interface FeedClientProps {
  recommendations: Recommendation[]
  groups: { id: string; name: string }[]
}

export function FeedClient({ recommendations, groups }: FeedClientProps) {
  const router = useRouter()
  const [actedIds, setActedIds] = useState<Set<string>>(new Set())
  const [friendActivity, setFriendActivity] = useState<Record<string, string[]>>({})
  const generatingRef = useRef(false)

  // Auto-replenish when fewer than 5 unseen recommendations remain
  useEffect(() => {
    const remaining = recommendations.filter(
      (r) => !actedIds.has(r.spotify_artist_id)
    ).length
    if (remaining < 5 && !generatingRef.current) {
      generatingRef.current = true
      fetch("/api/recommendations/generate", { method: "POST" })
        .then(() => router.refresh())
        .catch(() => {})
        .finally(() => { generatingRef.current = false })
    }
  }, [actedIds, recommendations, router])

  useEffect(() => {
    if (recommendations.length === 0) return
    const artistIds = recommendations.map((r) => r.spotify_artist_id).join(",")
    fetch(`/api/groups/activity?artistIds=${encodeURIComponent(artistIds)}`)
      .then((res) => res.ok ? res.json() : { activity: {} })
      .then((data) => {
        if (data.activity) setFriendActivity(data.activity)
      })
      .catch(() => {/* non-critical: badge just won't show pre-fetched names */})
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const visibleRecs = recommendations.filter(
    (r) => !actedIds.has(r.spotify_artist_id)
  )

  function handleActed(artistId: string) {
    setActedIds((prev) => new Set(prev).add(artistId))
  }

  const allCaughtUp = visibleRecs.length === 0

  const feedContent = allCaughtUp ? (
    <div className="flex flex-col items-center justify-center gap-3 py-20 text-center">
      <div className="flex size-14 items-center justify-center rounded-full bg-primary/10 ring-1 ring-primary/20">
        <CheckCircle2 className="size-7 text-primary" />
      </div>
      <p className="text-base font-semibold text-foreground">
        You&apos;re all caught up!
      </p>
      <p className="text-sm text-muted-foreground">Check back tomorrow for new discoveries.</p>
    </div>
  ) : (
    <div className="flex flex-col items-center gap-5 pb-8">
      {visibleRecs.map((rec) => (
        <ArtistCard
          key={rec.spotify_artist_id}
          spotifyArtistId={rec.spotify_artist_id}
          artist={rec.artist_data}
          why={rec.why}
          onActed={handleActed}
          friendNames={friendActivity[rec.spotify_artist_id] ?? []}
        />
      ))}
    </div>
  )

  // No groups — just render the feed directly without tabs
  if (groups.length === 0) {
    return (
      <div className="mx-auto w-full max-w-xl px-4 pt-6">
        {feedContent}
      </div>
    )
  }

  return (
    <div className="mx-auto w-full max-w-xl px-4 pt-6">
      <Tabs defaultValue="all">
        {/* Tab list */}
        <div className="sticky top-14 z-10 -mx-4 bg-background/95 px-4 pb-3 pt-1 backdrop-blur">
          <TabsList className="w-full overflow-x-auto">
            <TabsTrigger value="all" className="flex-1">
              All
            </TabsTrigger>
            {groups.map((group) => (
              <TabsTrigger key={group.id} value={group.id} className="flex-1">
                {group.name}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>

        {/* All tab */}
        <TabsContent value="all">
          {feedContent}
        </TabsContent>

        {/* Per-group tabs */}
        {groups.map((group) => (
          <TabsContent key={group.id} value={group.id}>
            <div className="flex flex-col items-center gap-4 py-10 text-center">
              <p className="text-sm font-medium text-foreground">{group.name}</p>
              <p className="text-xs text-muted-foreground">
                Group-specific feed is coming soon. Switch to <strong>All</strong> to browse your recommendations.
              </p>
            </div>
          </TabsContent>
        ))}
      </Tabs>
    </div>
  )
}
