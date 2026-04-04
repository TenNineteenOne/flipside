"use client"

import { useRef, useState } from "react"
import Image from "next/image"
import { Play, Pause, ThumbsUp, ThumbsDown, Bookmark, Music } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { GroupActivityBadge } from "@/components/feed/group-activity-badge"

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

interface WhyRec {
  sourceArtists: string[]
  genres: string[]
  friendBoost: string[]
}

interface ArtistCardProps {
  spotifyArtistId: string
  artist: ArtistWithTracks
  why: WhyRec
  onActed: (artistId: string) => void
  friendNames?: string[]
}

export function ArtistCard({ spotifyArtistId, artist, why, onActed, friendNames = [] }: ArtistCardProps) {
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const [playingTrackId, setPlayingTrackId] = useState<string | null>(null)
  const [loadingAction, setLoadingAction] = useState<string | null>(null)

  const visibleTracks = artist.topTracks.slice(0, 3)

  function handlePlayPause(track: Track) {
    if (!track.previewUrl) return

    if (playingTrackId === track.id) {
      // Pause current
      audioRef.current?.pause()
      setPlayingTrackId(null)
      return
    }

    // Stop any current audio
    if (audioRef.current) {
      audioRef.current.pause()
      audioRef.current.src = ""
    }

    const audio = new Audio(track.previewUrl)
    audioRef.current = audio
    audio.play().catch(() => {
      toast.error("Couldn't play preview")
    })
    setPlayingTrackId(track.id)

    audio.addEventListener("ended", () => {
      setPlayingTrackId(null)
    })
  }

  async function handleFeedback(signal: "thumbs_up" | "thumbs_down") {
    const key = signal
    setLoadingAction(key)
    try {
      const res = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ spotifyArtistId, signal }),
      })
      if (!res.ok) throw new Error("Failed to submit feedback")
      audioRef.current?.pause()
      onActed(spotifyArtistId)
    } catch {
      toast.error("Couldn't save your feedback. Try again.")
    } finally {
      setLoadingAction(null)
    }
  }

  async function handleSave() {
    setLoadingAction("save")
    try {
      const res = await fetch("/api/saves", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          spotifyArtistId,
          spotifyTrackId: artist.topTracks[0]?.id,
        }),
      })
      if (!res.ok) throw new Error("Failed to save artist")
      audioRef.current?.pause()
      onActed(spotifyArtistId)
      toast.success(`Saved ${artist.name}`)
    } catch {
      toast.error("Couldn't save artist. Try again.")
    } finally {
      setLoadingAction(null)
    }
  }

  const whyText =
    why.sourceArtists.length > 0
      ? `Because you like ${why.sourceArtists.slice(0, 2).join(" & ")}`
      : why.genres.length > 0
        ? `Based on your love of ${why.genres.slice(0, 2).join(" & ")}`
        : null

  return (
    <article className="w-full max-w-xl overflow-hidden rounded-2xl border border-border bg-card shadow-lg shadow-black/20">
      {/* Artist image with overlay */}
      <div className="relative aspect-square w-full overflow-hidden">
        {artist.imageUrl ? (
          <Image
            src={artist.imageUrl}
            alt={artist.name}
            fill
            className="object-cover"
            sizes="(max-width: 640px) 100vw, 576px"
            priority={false}
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-muted">
            <Music className="size-16 text-muted-foreground/40" />
          </div>
        )}

        {/* Gradient overlay */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent" />

        {/* Artist name + genres at bottom */}
        <div className="absolute bottom-0 left-0 right-0 p-4">
          <h2 className="text-2xl font-bold leading-tight text-white drop-shadow-lg">
            {artist.name}
          </h2>
          {artist.genres.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {artist.genres.slice(0, 4).map((genre) => (
                <span
                  key={genre}
                  className="rounded-full bg-white/15 px-2.5 py-0.5 text-xs font-medium text-white/90 backdrop-blur-sm"
                >
                  {genre}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Social proof badge — always mounted so realtime subscription is active */}
      <div className="px-4 pt-3 -mb-1">
        <GroupActivityBadge
          spotifyArtistId={spotifyArtistId}
          initialFriendNames={friendNames}
        />
      </div>

      {/* Card body */}
      <div className="flex flex-col gap-4 p-4">
        {/* Why section */}
        <div className="space-y-1">
          {whyText && (
            <p className="text-xs font-medium text-muted-foreground">{whyText}</p>
          )}
          {why.friendBoost.length > 0 && (
            <p className="text-xs text-accent">
              ✨ {why.friendBoost[0]} also saved this
            </p>
          )}
        </div>

        {/* Track list */}
        {visibleTracks.length > 0 && (
          <div className="space-y-1">
            {visibleTracks.map((track) => {
              const isPlaying = playingTrackId === track.id
              const canPlay = !!track.previewUrl
              return (
                <div
                  key={track.id}
                  className={cn(
                    "flex items-center gap-3 rounded-xl px-2 py-2 transition-colors",
                    isPlaying
                      ? "bg-primary/10 ring-1 ring-primary/20"
                      : "hover:bg-muted/60"
                  )}
                >
                  {/* Album art */}
                  <div className="relative size-10 shrink-0 overflow-hidden rounded-md bg-muted">
                    {track.albumImageUrl ? (
                      <Image
                        src={track.albumImageUrl}
                        alt={track.albumName}
                        fill
                        className="object-cover"
                        sizes="40px"
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center">
                        <Music className="size-4 text-muted-foreground/40" />
                      </div>
                    )}
                  </div>

                  {/* Track info */}
                  <div className="min-w-0 flex-1">
                    <p
                      className={cn(
                        "truncate text-sm font-medium leading-tight",
                        isPlaying ? "text-primary" : "text-foreground"
                      )}
                    >
                      {track.name}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {track.albumName}
                    </p>
                  </div>

                  {/* Play button */}
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => handlePlayPause(track)}
                    disabled={!canPlay}
                    aria-label={isPlaying ? "Pause" : "Play preview"}
                    className={cn(
                      "shrink-0",
                      isPlaying && "text-primary hover:text-primary",
                      !canPlay && "opacity-30"
                    )}
                  >
                    {isPlaying ? (
                      <Pause className="size-4" />
                    ) : (
                      <Play className="size-4" />
                    )}
                  </Button>
                </div>
              )
            })}
          </div>
        )}

        {/* Action buttons */}
        <div className="flex items-center justify-between gap-2 pt-1">
          {/* Thumbs down */}
          <Button
            variant="ghost"
            size="icon"
            onClick={() => handleFeedback("thumbs_down")}
            disabled={loadingAction !== null}
            aria-label="Not for me"
            className="size-11 rounded-full text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
          >
            <ThumbsDown className="size-5" />
          </Button>

          {/* Save — centered, primary */}
          <Button
            variant="default"
            onClick={handleSave}
            disabled={loadingAction !== null}
            className="flex h-11 flex-1 items-center justify-center gap-2 rounded-full bg-primary text-primary-foreground shadow-md shadow-primary/30 hover:bg-primary/80"
          >
            <Bookmark className="size-4" />
            <span className="text-sm font-semibold">Save Artist</span>
          </Button>

          {/* Thumbs up */}
          <Button
            variant="ghost"
            size="icon"
            onClick={() => handleFeedback("thumbs_up")}
            disabled={loadingAction !== null}
            aria-label="Love this"
            className="size-11 rounded-full text-muted-foreground hover:bg-primary/10 hover:text-primary"
          >
            <ThumbsUp className="size-5" />
          </Button>
        </div>
      </div>
    </article>
  )
}
