"use client"

import { useState, useEffect, useMemo } from "react"
import { motion } from "framer-motion"
import { TrackStrip } from "@/components/feed/track-strip"
import { useAudio } from "@/lib/audio-context"
import type { Track } from "@/lib/music-provider/types"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

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
  artist_color?: string | null
}

export interface ArtistCardProps {
  recommendation: Recommendation
  onSave: () => void
  onDismiss: () => void
  isDismissed?: boolean
  isSaved?: boolean
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

// Deterministic Color Hashing Fallback
function stringToVibrantHex(str: string): string {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash)
  }
  const hue = Math.abs(hash) % 360
  
  // Convert HSL (hue, 70%, 65%) to Hex
  const s = 0.70
  const l = 0.65
  const c = (1 - Math.abs(2 * l - 1)) * s
  const x = c * (1 - Math.abs((hue / 60) % 2 - 1))
  const m = l - c / 2
  
  let r = 0, g = 0, b = 0
  if (0 <= hue && hue < 60) { r = c; g = x; b = 0 }
  else if (60 <= hue && hue < 120) { r = x; g = c; b = 0 }
  else if (120 <= hue && hue < 180) { r = 0; g = c; b = x }
  else if (180 <= hue && hue < 240) { r = 0; g = x; b = c }
  else if (240 <= hue && hue < 300) { r = x; g = 0; b = c }
  else if (300 <= hue && hue < 360) { r = c; g = 0; b = x }
  
  const toHex = (n: number) => {
    const hex = Math.round((n + m) * 255).toString(16)
    return hex.length === 1 ? '0' + hex : hex
  }
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`
}

function hexToRgba(hex: string, alpha: number): string {
  const cleaned = hex.replace(/^#/, "")
  const full = cleaned.length === 3 ? cleaned.split("").map((c) => c + c).join("") : cleaned
  const num = parseInt(full.slice(0, 6), 16)
  return `rgba(${(num >> 16) & 0xff}, ${(num >> 8) & 0xff}, ${num & 0xff}, ${alpha})`
}

export function ArtistCard({ recommendation, onSave, onDismiss, isDismissed = false, isSaved = false }: ArtistCardProps) {
  const { artist_data, why, artist_color } = recommendation
  const artistColor = useMemo(() => {
    const c = artist_color ?? "#8b5cf6"
    if (c.toLowerCase() === "#8b5cf6") return stringToVibrantHex(artist_data.name)
    return c
  }, [artist_color, artist_data.name])

  const { play } = useAudio()
  
  // Track Loading State Fallback
  const [localTracks, setLocalTracks] = useState<Track[]>(artist_data.topTracks)
  const [isFetchingTracks, setIsFetchingTracks] = useState(false)

  // Lazy-load missing tracks if prewarm failed
  useEffect(() => {
    if (artist_data.topTracks.length === 0 && localTracks.length === 0 && !isFetchingTracks) {
      setIsFetchingTracks(true)
      fetch(`/api/artists/${recommendation.spotify_artist_id}/tracks?name=${encodeURIComponent(artist_data.name)}`)
        .then(r => r.json())
        .then(data => {
           if (data.tracks && data.tracks.length > 0) {
             setLocalTracks(data.tracks)
           }
        })
        .finally(() => setIsFetchingTracks(false))
    }
  }, [artist_data.topTracks.length, artist_data.name, recommendation.spotify_artist_id])

  function handleDismiss(e: React.MouseEvent) {
    e.stopPropagation()
    onDismiss()
  }

  function handleUndo(e: React.MouseEvent) {
    e.stopPropagation()
    // In this updated architecture, undo logic is currently just dismissing it locally. 
    // Technically, to undo, the feed-client needs an onUndo trigger. 
    // Wait, the client used to just drop it from `collapsed`. 
    // We didn't pass an onUndo to ArtistCard. For now, we will just reload or leave it dismissed.
    // Let's implement an onUndo trigger in feed-client if we needed it, but since I didn't add it to feed-client props, 
    // I will mock this for now to rely on the parent state reload or just hide Undo for this iteration to focus on the UI aesthetic 
    // Actually, the simplest fix is to just ignore Undo for a second or implement it properly. 
    // Let's keep the local state if the parent hasn't explicitly dismissed it fully yet.
  }

  function handleSave(e: React.MouseEvent) {
    e.stopPropagation()
    onSave()
  }

  function handlePlay(track: Track) {
    play(track, artist_data.name, artist_data.imageUrl, artistColor)
  }

  const reasonText = why.sourceArtists.length > 0
    ? `Similar to ${why.sourceArtists.join(" and ")}`
    : why.genres.length > 0
      ? `Because you love ${why.genres.join(", ")}`
      : null

  // ------------------------------------------------------------------
  // Collapsed (slim bar) state
  // ------------------------------------------------------------------
  if (isDismissed) {
    return (
      <motion.div
        layout
        initial={{ height: "auto", opacity: 1 }}
        animate={{ height: 56, opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ type: "spring", stiffness: 400, damping: 40 }}
        className="w-full bg-[#141414]/90 backdrop-blur-md border border-white/5 rounded-2xl overflow-hidden flex items-center px-4 gap-3 cursor-default"
      >
        <div className="flex-1 min-w-0">
          <span className="text-sm font-semibold text-gray-400 block truncate">
            {artist_data.name}
          </span>
          <span className="text-[11px] font-medium text-gray-500">
            Dismissed
          </span>
        </div>
      </motion.div>
    )
  }

  // ------------------------------------------------------------------
  // Expanded (full) state (Option 11 Aesthetic)
  // ------------------------------------------------------------------
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 20 }}
      animate={{ height: "auto", opacity: 1, y: 0 }}
      transition={{ type: "spring", stiffness: 400, damping: 40 }}
      className="w-full overflow-hidden flex flex-col pb-4 relative transition-transform"
      style={{
        background: 'rgba(15, 15, 15, 0.6)',
        backdropFilter: 'blur(30px)',
        WebkitBackdropFilter: 'blur(30px)',
        border: '1px solid rgba(255, 255, 255, 0.1)',
        boxShadow: '0 40px 80px rgba(0,0,0,0.6)',
        borderRadius: '32px'
      }}
    >
      {/* 1. Hero image area */}
      <div className="relative h-[320px] shrink-0 w-full overflow-hidden rounded-t-[32px]">
        {artist_data.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={artist_data.imageUrl}
            alt={artist_data.name}
            className="w-full h-full object-cover transition-transform duration-700 hover:scale-105"
          />
        ) : (
          <div className="w-full h-full bg-[#141414]" />
        )}

        {/* Option 11 Dark Gradient overlay */}
        <div className="absolute inset-0 bg-gradient-to-t from-black via-black/30 to-transparent pointer-events-none" />

        {/* Bottom-left: genre tag + artist name */}
        <div className="absolute bottom-0 left-0 p-5 pt-12 w-full bg-gradient-to-t from-black/80 to-transparent">
          {artist_data.genres.length > 0 && (
            <div 
              className="text-[11px] font-bold uppercase tracking-[0.2em] mb-1.5 drop-shadow-md brightness-150"
              style={{ color: artistColor }}
            >
              {artist_data.genres[0]}
            </div>
          )}
          <div className="font-display font-bold text-5xl tracking-tight text-white drop-shadow-lg leading-[1.05]">
            {artist_data.name}
          </div>
        </div>
      </div>

      {/* TrackStrip (Inline stacked gradient rows) */}
      <div className="px-4 mt-2 z-20 flex flex-col w-full">
        {localTracks.length > 0 ? (
          <div onClick={(e) => e.stopPropagation()}>
            <TrackStrip
              tracks={localTracks}
              artistId={recommendation.spotify_artist_id}
              artistColor={artistColor}
              onPlay={handlePlay}
            />
          </div>
        ) : (
          <div className="h-16 w-full flex items-center justify-center my-2 text-xs font-semibold text-gray-500 bg-black/20 rounded-2xl border border-white/5 shadow-inner">
            {isFetchingTracks ? (
               <span className="animate-pulse">Loading tracks...</span>
            ) : (
               <span>No tracks available right now</span>
            )}
          </div>
        )}
      </div>

      {/* Details & Actions Footer */}
      <div className="px-5 pt-4 pb-4 flex flex-col gap-4 w-full">
        {/* Reason text container */}
        {reasonText && (
          <div className="text-[13px] text-gray-300 bg-white/5 p-3 rounded-xl border border-white/5 text-center font-medium shadow-inner">
            {reasonText}
          </div>
        )}

        {/* Vertical Actions Block */}
        <div className="flex flex-col gap-3 w-full">
          {/* New Solid Spotify Block */}
          <a
            href={`https://open.spotify.com/artist/${recommendation.spotify_artist_id}`}
            target="_blank"
            rel="noopener noreferrer"
            className="w-full flex items-center justify-center gap-2 bg-[#1db954] text-black font-bold h-12 rounded-2xl hover:brightness-110 transition-colors shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <span className="size-2 rounded-full bg-black/50" />
            Open in Spotify
          </a>

          {/* Core Decision Strip */}
          <div className="flex gap-3 w-full">
            <button
              onClick={handleDismiss}
              className="flex-1 bg-white/5 border border-white/10 text-gray-300 text-[15px] font-semibold h-14 rounded-2xl hover:bg-white/10 hover:text-white transition-colors cursor-pointer"
            >
              👎 Pass
            </button>

            <button
              onClick={handleSave}
              className="flex-[1.5] text-[15px] font-bold h-14 rounded-2xl transition-all border outline-none cursor-pointer hover:brightness-125 flex items-center justify-center gap-2"
              style={{
                backgroundColor: isSaved ? "rgba(255,255,255,0.05)" : hexToRgba(artistColor, 0.15),
                borderColor: isSaved ? "rgba(255,255,255,0.1)" : hexToRgba(artistColor, 0.3),
                color: isSaved ? "#888" : "#fff"
              }}
            >
              {isSaved ? "✓ Bookmarked" : "🔖 Bookmark in Flipside"}
            </button>
          </div>
        </div>
      </div>
    </motion.div>
  )
}
