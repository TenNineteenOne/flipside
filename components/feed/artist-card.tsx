"use client"

import { useEffect, useRef, useState } from "react"
import Image from "next/image"
import { ThumbsUp, ThumbsDown, Music, Heart, ListPlus, Bookmark, ExternalLink, RefreshCw, Loader2 } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

interface Track {
  id: string
  spotifyTrackId: string | null
  name: string
  previewUrl: string | null
  durationMs: number
  albumName: string
  albumImageUrl: string | null
  source: 'itunes' | 'spotify' | 'deezer'
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

  const articleRef = useRef<HTMLElement>(null)
  const [isInView, setIsInView] = useState(false)

  // Fire track fetch only once the card enters the viewport (10% visible).
  // With 20 cards in the DOM, this reduces simultaneous Spotify calls from
  // 20 → 1-2 (only the cards actually on screen).
  useEffect(() => {
    const el = articleRef.current
    if (!el) return
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsInView(true)
          observer.disconnect()
        }
      },
      { threshold: 0.1 }
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const [tracks, setTracks] = useState<Track[]>(artist.topTracks ?? [])
  const [tracksStatus, setTracksStatus] = useState<'idle' | 'loading' | 'error'>(
    (artist.topTracks?.length ?? 0) > 0 ? 'idle' : 'loading'
  )
  const [tracksAttempt, setTracksAttempt] = useState(0)

  useEffect(() => {
    if (!isInView) return
    if (tracks.length > 0 && tracksStatus === 'idle') return
    let cancelled = false
    setTracksStatus('loading')
    fetch(`/api/artists/${artist.id}/tracks`)
      .then(async (r) => {
        if (!r.ok) throw new Error(`http_${r.status}`)
        const data = (await r.json()) as { tracks: Track[] }
        if (cancelled) return
        setTracks(data.tracks ?? [])
        setTracksStatus('idle')
      })
      .catch((err) => {
        console.log(`[card] tracks-fail artistId=${artist.id} err=${err instanceof Error ? err.message : String(err)}`)
        if (cancelled) return
        setTracksStatus('error')
      })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [artist.id, tracksAttempt, isInView])

  const visibleTracks = tracks.slice(0, 5)

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
    } catch (err) {
      console.error(`[card] feedback failed artistId=${spotifyArtistId}`, err)
      toast.error("Couldn't save your feedback. Try again.")
    } finally {
      setLoadingAction(null)
    }
  }

  /**
   * Resolve a track's Spotify ID just-in-time. If already known (Spotify-sourced
   * or previously resolved), returns immediately. Otherwise hits
   * /api/spotify/resolve-track. Updates local state so subsequent clicks skip
   * the network.
   */
  async function resolveSpotifyTrackId(track: Track): Promise<string | null> {
    if (track.spotifyTrackId) return track.spotifyTrackId
    try {
      const res = await fetch("/api/spotify/resolve-track", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          spotifyArtistId,
          artistName: artist.name,
          trackName: track.name,
          localTrackId: track.id,
        }),
      })
      if (!res.ok) return null
      const data = (await res.json()) as { spotifyTrackId: string }
      if (!data.spotifyTrackId) return null
      setTracks((prev) =>
        prev.map((t) => (t.id === track.id ? { ...t, spotifyTrackId: data.spotifyTrackId } : t))
      )
      return data.spotifyTrackId
    } catch (err) {
      console.error(`[card] resolve failed trackId=${track.id}`, err)
      return null
    }
  }

  async function handleLikeTrack(track: Track) {
    if (loadingTrack) return
    setLoadingTrack({ id: track.id, action: 'like' })
    try {
      const spotifyTrackId = await resolveSpotifyTrackId(track)
      if (!spotifyTrackId) {
        toast.error("Couldn't find this on Spotify.")
        return
      }
      const res = await fetch("/api/spotify/like", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ trackId: spotifyTrackId }),
      })
      const data = await res.json().catch(() => ({}))
      if (res.status === 403) {
        toast.error("Couldn't like via Flipside — open the track in Spotify to like it there.")
        return
      }
      if (!res.ok) throw new Error(data?.error ?? "Failed")
      toast.success("Liked in Spotify!")
    } catch (err) {
      console.error(`[card] like failed trackId=${track.id}`, err)
      toast.error("Couldn't like track. Try again.")
    } finally {
      setLoadingTrack(null)
    }
  }

  async function handleSaveToPlaylist(track: Track) {
    if (loadingTrack) return
    setLoadingTrack({ id: track.id, action: 'playlist' })
    try {
      const spotifyTrackId = await resolveSpotifyTrackId(track)
      if (!spotifyTrackId) {
        toast.error("Couldn't find this on Spotify.")
        return
      }
      const res = await fetch("/api/saves", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ spotifyArtistId, spotifyTrackId, addToPlaylist: true }),
      })
      if (!res.ok) throw new Error("Failed")
      toast.success("Added to your Flipside Discoveries playlist on Spotify!")
    } catch (err) {
      console.error(`[card] playlist failed trackId=${track.id}`, err)
      toast.error("Couldn't add to playlist. Try again.")
    } finally {
      setLoadingTrack(null)
    }
  }

  async function handleSaveToFlipside(track: Track) {
    if (loadingTrack) return
    setLoadingTrack({ id: track.id, action: 'flipside' })
    try {
      // Saving to Flipside doesn't strictly need a Spotify track id, but we
      // resolve opportunistically so the saved row links cleanly and the
      // Saved page can render the track card.
      const spotifyTrackId = await resolveSpotifyTrackId(track)
      const res = await fetch("/api/saves", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          spotifyArtistId,
          spotifyTrackId: spotifyTrackId ?? undefined,
        }),
      })
      if (!res.ok) throw new Error("Failed")
      toast.success("Saved to Flipside!")
    } catch (err) {
      console.error(`[card] save failed trackId=${track.id}`, err)
      toast.error("Couldn't save. Try again.")
    } finally {
      setLoadingTrack(null)
    }
  }

  async function handleOpenInSpotify(track: Track, e: React.MouseEvent<HTMLAnchorElement>) {
    if (track.spotifyTrackId) return // let the <a> navigate normally
    e.preventDefault()
    if (loadingTrack) return
    setLoadingTrack({ id: track.id, action: 'like' })
    try {
      const spotifyTrackId = await resolveSpotifyTrackId(track)
      if (!spotifyTrackId) {
        toast.error("Couldn't find this on Spotify.")
        return
      }
      window.open(`https://open.spotify.com/track/${spotifyTrackId}`, "_blank", "noopener,noreferrer")
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
    } catch (err) {
      console.error(`[card] save-artist failed artistId=${spotifyArtistId}`, err)
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
    <article ref={articleRef} className="w-full max-w-xl overflow-hidden rounded-2xl border border-border bg-card shadow-lg shadow-black/20">
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

        {/* Track list — lazy loaded */}
        {tracksStatus === 'loading' && visibleTracks.length === 0 && (
          <div className="flex items-center justify-center gap-2 rounded-xl bg-muted/40 px-3 py-6 text-xs text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            Loading tracks…
          </div>
        )}
        {tracksStatus === 'error' && visibleTracks.length === 0 && (
          <div className="flex flex-col items-center gap-2 rounded-xl bg-muted/40 px-3 py-4 text-xs text-muted-foreground">
            <span>Couldn’t load tracks.</span>
            <button
              onClick={() => setTracksAttempt((n) => n + 1)}
              className="flex items-center gap-1 rounded-full border border-border bg-background px-2.5 py-1 font-medium text-foreground hover:bg-muted"
            >
              <RefreshCw className="size-3" />
              Retry
            </button>
          </div>
        )}
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
                      onClick={() => handleLikeTrack(track)}
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
                      onClick={() => handleSaveToPlaylist(track)}
                      disabled={trackLoading}
                      className={cn(
                        "flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium transition-colors",
                        "bg-background border border-border text-muted-foreground hover:text-green-500 hover:border-green-500/50",
                        trackLoading && "opacity-50 cursor-not-allowed"
                      )}
                    >
                      <ListPlus className="size-3" />
                      Add to Spotify Playlist
                    </button>

                    <button
                      onClick={() => handleSaveToFlipside(track)}
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
                      href={
                        track.spotifyTrackId
                          ? `https://open.spotify.com/track/${track.spotifyTrackId}`
                          : "#"
                      }
                      onClick={(e) => handleOpenInSpotify(track, e)}
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
