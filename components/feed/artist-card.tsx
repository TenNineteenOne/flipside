"use client"

import { useState } from "react"
import Image from "next/image"
import { ThumbsUp, ThumbsDown, Music, Heart, ListPlus, Bookmark, ExternalLink } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

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
}

export function ArtistCard({ spotifyArtistId, artist, why, onActed }: ArtistCardProps) {
  const [loadingAction, setLoadingAction] = useState<'thumbs_up' | 'thumbs_down' | 'save_artist' | null>(null)
  const [loadingTrack, setLoadingTrack] = useState<{ id: string; action: 'like' | 'playlist' | 'flipside' } | null>(null)

  const visibleTracks = artist.topTracks.slice(0, 5)

  async function handleFeedback(signal: "thumbs_up" | "thumbs_down") {
    setLoadingAction(signal)
    try {
      const res = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ spotifyArtistId, signal }),
      })
      if (!res.ok) throw new Error("Failed to submit feedback")
      onActed(spotifyArtistId)
    } catch {
      toast.error("Couldn't save your feedback. Try again.")
    } finally {
      setLoadingAction(null)
    }
  }

  async function handleLikeTrack(trackId: string) {
    if (loadingTrack) return
    setLoadingTrack({ id: trackId, action: 'like' })
    try {
      const res = await fetch("/api/spotify/like", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ trackId }),
      })
      const data = await res.json().catch(() => ({}))
      if (res.status === 403) {
        toast.error("Sign out and back in to enable Liking tracks in Spotify.")
        return
      }
      if (!res.ok) throw new Error(data?.error ?? "Failed")
      toast.success("Liked in Spotify!")
    } catch {
      toast.error("Couldn't like track. Try again.")
    } finally {
      setLoadingTrack(null)
    }
  }

  async function handleSaveToPlaylist(trackId: string) {
    if (loadingTrack) return
    setLoadingTrack({ id: trackId, action: 'playlist' })
    try {
      const res = await fetch("/api/saves", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ spotifyArtistId, spotifyTrackId: trackId, addToPlaylist: true }),
      })
      if (!res.ok) throw new Error("Failed")
      toast.success("Added to Flipside Discoveries playlist!")
    } catch {
      toast.error("Couldn't add to playlist. Try again.")
    } finally {
      setLoadingTrack(null)
    }
  }

  async function handleSaveToFlipside(trackId: string) {
    if (loadingTrack) return
    setLoadingTrack({ id: trackId, action: 'flipside' })
    try {
      const res = await fetch("/api/saves", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ spotifyArtistId, spotifyTrackId: trackId }),
      })
      if (!res.ok) throw new Error("Failed")
      toast.success("Saved to Flipside!")
    } catch {
      toast.error("Couldn't save. Try again.")
    } finally {
      setLoadingTrack(null)
    }
  }

  async function handleSaveArtist() {
    if (loadingAction) return
    setLoadingAction('save_artist')
    try {
      const res = await fetch("/api/saves", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ spotifyArtistId }),
      })
      if (!res.ok) throw new Error("Failed")
      toast.success("Artist saved to Flipside!")
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
      <div className="relative aspect-square w-full max-h-[55vh] overflow-hidden">
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

      {/* Card body */}
      <div className="flex flex-col gap-4 p-4">
        {/* Why section */}
        {whyText && (
          <p className="text-xs font-medium text-muted-foreground">{whyText}</p>
        )}

        {/* Track list */}
        {visibleTracks.length > 0 && (
          <div className="space-y-2">
            {visibleTracks.map((track) => {
              const trackLoading = loadingTrack?.id === track.id
              return (
                <div key={track.id} className="rounded-xl bg-muted/40 px-3 py-2">
                  {/* Row 1: album art + track info */}
                  <div className="flex items-center gap-3">
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
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium leading-tight text-foreground">
                        {track.name}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">
                        {track.albumName}
                      </p>
                    </div>
                  </div>

                  {/* Row 2: action buttons */}
                  <div className="mt-2 flex flex-wrap gap-1.5 pl-[52px]">
                    <button
                      onClick={() => handleLikeTrack(track.id)}
                      disabled={trackLoading}
                      className={cn(
                        "flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium transition-colors",
                        "bg-background border border-border text-muted-foreground hover:text-pink-500 hover:border-pink-500/50",
                        trackLoading && "opacity-50 cursor-not-allowed"
                      )}
                    >
                      <Heart className="size-3" />
                      Like in Spotify
                    </button>

                    <button
                      onClick={() => handleSaveToPlaylist(track.id)}
                      disabled={trackLoading}
                      className={cn(
                        "flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium transition-colors",
                        "bg-background border border-border text-muted-foreground hover:text-green-500 hover:border-green-500/50",
                        trackLoading && "opacity-50 cursor-not-allowed"
                      )}
                    >
                      <ListPlus className="size-3" />
                      Add to Discoveries
                    </button>

                    <button
                      onClick={() => handleSaveToFlipside(track.id)}
                      disabled={trackLoading}
                      className={cn(
                        "flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium transition-colors",
                        "bg-background border border-border text-muted-foreground hover:text-primary hover:border-primary/50",
                        trackLoading && "opacity-50 cursor-not-allowed"
                      )}
                    >
                      <Bookmark className="size-3" />
                      Save to Flipside
                    </button>

                    <a
                      href={`https://open.spotify.com/track/${track.id}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1 rounded-full border border-border bg-background px-2.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground hover:border-foreground/30"
                    >
                      <ExternalLink className="size-3" />
                      Open in Spotify
                    </a>
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {/* Action row: thumbs + save artist */}
        <div className="flex items-center justify-between gap-2 pt-1">
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

          <Button
            variant="ghost"
            onClick={handleSaveArtist}
            disabled={loadingAction !== null}
            aria-label="Save artist to Flipside"
            className="flex items-center gap-1.5 rounded-full px-4 text-sm font-medium text-muted-foreground hover:bg-primary/10 hover:text-primary"
          >
            <Bookmark className="size-4" />
            Save Artist
          </Button>

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
