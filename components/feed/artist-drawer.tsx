'use client'

import { useState } from 'react'
import Image from 'next/image'
import { motion, AnimatePresence } from 'framer-motion'
import { Play } from 'lucide-react'
import { useAudio } from '@/lib/audio-context'
import type { Track } from '@/lib/music-provider/types'

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

export interface ArtistDrawerProps {
  recommendation: Recommendation | null  // null = drawer closed
  artistColor: string                    // hex, '#8b5cf6' fallback
  isOpen: boolean
  onDismiss: () => void                  // close drawer only
  onDismissAndCollapse: () => void       // close drawer + collapse underlying card
  onSave: () => void
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}:${seconds.toString().padStart(2, '0')}`
}

function formatListeners(popularity: number): string {
  // Spotify popularity is 0-100; approximate monthly listeners
  const approx = Math.round((popularity / 100) * 50_000_000)
  if (approx >= 1_000_000) {
    return `${(approx / 1_000_000).toFixed(1)}M monthly listeners`
  }
  if (approx >= 1_000) {
    return `${Math.round(approx / 1_000)}K monthly listeners`
  }
  return `${approx} monthly listeners`
}

// ---------------------------------------------------------------------------
// Track row
// ---------------------------------------------------------------------------

interface TrackRowProps {
  track: Track
  index: number
  isPlaying: boolean
  onPlay: () => void
}

function TrackRow({ track, index, isPlaying, onPlay }: TrackRowProps) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '8px 16px',
        borderRadius: 8,
        background: isPlaying ? '#161616' : 'transparent',
        transition: 'background 0.15s',
      }}
    >
      {/* Track number */}
      <span
        style={{
          fontSize: 10,
          fontFamily: 'Inter, sans-serif',
          fontWeight: 400,
          color: 'var(--text-muted)',
          width: 16,
          flexShrink: 0,
          textAlign: 'center',
        }}
      >
        {index + 1}
      </span>

      {/* Album art */}
      <div
        style={{
          width: 30,
          height: 30,
          borderRadius: 4,
          overflow: 'hidden',
          flexShrink: 0,
          background: '#2a2a2a',
        }}
      >
        {track.albumImageUrl ? (
          <Image
            src={track.albumImageUrl}
            alt={track.albumName}
            width={30}
            height={30}
            style={{ objectFit: 'cover', width: '100%', height: '100%' }}
            unoptimized
          />
        ) : (
          <div style={{ width: '100%', height: '100%', background: '#333' }} />
        )}
      </div>

      {/* Track name + duration */}
      <div
        style={{
          flex: 1,
          minWidth: 0,
          display: 'flex',
          flexDirection: 'column',
          gap: 2,
        }}
      >
        <span
          style={{
            fontSize: 11,
            fontFamily: 'Inter, sans-serif',
            fontWeight: 500,
            color: isPlaying ? '#eee' : '#888',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {track.name}
        </span>
        <span
          style={{
            fontSize: 9,
            fontFamily: 'Inter, sans-serif',
            fontWeight: 400,
            color: 'var(--text-muted)',
          }}
        >
          {formatDuration(track.durationMs)}
        </span>
      </div>

      {/* Play button */}
      <button
        onClick={onPlay}
        aria-label={`Play ${track.name}`}
        style={{
          width: 28,
          height: 28,
          borderRadius: '50%',
          background: isPlaying ? 'var(--accent)' : '#141414',
          border: isPlaying ? 'none' : '1px solid #1e1e1e',
          color: isPlaying ? '#fff' : 'var(--text-muted)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
          cursor: 'pointer',
          padding: 0,
        }}
      >
        <Play size={11} fill="currentColor" strokeWidth={0} />
      </button>
    </div>
  )
}

// ---------------------------------------------------------------------------
// ArtistDrawer
// ---------------------------------------------------------------------------

const INITIAL_TRACK_COUNT = 5
const EXPANDED_TRACK_COUNT = 10

export function ArtistDrawer({
  recommendation,
  artistColor,
  isOpen,
  onDismiss,
  onDismissAndCollapse,
  onSave,
}: ArtistDrawerProps) {
  const [showMore, setShowMore] = useState(false)
  const { currentTrack, play } = useAudio()

  // Reset "show more" when the drawer opens for a new artist
  // (simple approach — reset whenever recommendation changes)
  const artist = recommendation?.artist_data ?? null
  const why = recommendation?.why
  const spotifyArtistId = recommendation?.spotify_artist_id ?? ''

  const spotifyUrl = `https://open.spotify.com/artist/${spotifyArtistId}`

  const reasonText = why
    ? why.sourceArtists.length > 0
      ? `Because you listen to ${why.sourceArtists.join(' and ')}${why.genres.length > 0 ? ' · ' + why.genres.join(', ') : ''}`
      : why.genres.length > 0
        ? `Because you love ${why.genres.join(', ')}`
        : null
    : null

  const trackLimit = showMore ? EXPANDED_TRACK_COUNT : INITIAL_TRACK_COUNT
  const visibleTracks = artist?.topTracks.slice(0, trackLimit) ?? []
  const hasMore = (artist?.topTracks.length ?? 0) > INITIAL_TRACK_COUNT && !showMore

  function handlePlay(track: Track) {
    if (!artist) return
    play(track, artist.name, artist.imageUrl, artistColor)
  }

  return (
    <AnimatePresence>
      {isOpen && recommendation && artist && (
        <>
          {/* Backdrop */}
          <motion.div
            key="backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={onDismiss}
            style={{
              position: 'fixed',
              inset: 0,
              background: 'rgba(0,0,0,0.55)',
              zIndex: 9,
            }}
          />

          {/* Sheet */}
          <motion.div
            key="sheet"
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', stiffness: 400, damping: 40 }}
            drag="y"
            dragConstraints={{ top: 0 }}
            dragElastic={{ top: 0 }}
            onDragEnd={(_event, info) => {
              if (info.offset.y > 100) {
                onDismiss()
              }
            }}
            style={{
              position: 'fixed',
              bottom: 0,
              left: 0,
              right: 0,
              zIndex: 10,
              borderRadius: '16px 16px 0 0',
              background: 'var(--bg-elevated)',
              maxHeight: '85vh',
              overflowY: 'auto',
            }}
          >
            {/* × close button */}
            <button
              onClick={onDismiss}
              aria-label="Close drawer"
              style={{
                position: 'absolute',
                top: 12,
                right: 14,
                width: 24,
                height: 24,
                borderRadius: '50%',
                background: 'rgba(255,255,255,0.08)',
                border: 'none',
                color: 'var(--text-muted)',
                fontSize: 12,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                padding: 0,
                lineHeight: 1,
              }}
            >
              &times;
            </button>

            {/* Drag handle */}
            <div style={{ padding: '10px 0 0', textAlign: 'center' }}>
              <div
                style={{
                  width: 30,
                  height: 3,
                  background: '#333',
                  borderRadius: 2,
                  margin: '0 auto',
                }}
              />
            </div>

            {/* Header row */}
            <div
              style={{
                padding: '14px 16px 0',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 12,
              }}
            >
              {/* Left: name + listeners */}
              <div style={{ minWidth: 0 }}>
                <div
                  style={{
                    fontSize: 13,
                    fontFamily: 'Inter, sans-serif',
                    fontWeight: 600,
                    color: 'var(--text-primary)',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                >
                  {artist.name}
                </div>
                <div
                  style={{
                    fontSize: 10,
                    fontFamily: 'Inter, sans-serif',
                    fontWeight: 400,
                    color: 'var(--text-muted)',
                    marginTop: 2,
                  }}
                >
                  {formatListeners(artist.popularity)}
                </div>
              </div>

              {/* Right: Save button */}
              <button
                onClick={onSave}
                style={{
                  height: 28,
                  borderRadius: 8,
                  background: artistColor,
                  border: 'none',
                  color: '#000',
                  fontSize: 11,
                  fontFamily: 'Inter, sans-serif',
                  fontWeight: 600,
                  padding: '0 12px',
                  cursor: 'pointer',
                  flexShrink: 0,
                  whiteSpace: 'nowrap',
                }}
              >
                + Save
              </button>
            </div>

            {/* Reason text */}
            {reasonText && (
              <div
                style={{
                  padding: '10px 16px 4px',
                  fontSize: 11,
                  fontFamily: 'Inter, sans-serif',
                  fontWeight: 400,
                  color: 'var(--text-muted)',
                }}
              >
                {reasonText}
              </div>
            )}

            {/* Genre pills */}
            {artist.genres.length > 0 && (
              <div
                style={{
                  padding: '0 16px 12px',
                  display: 'flex',
                  flexWrap: 'wrap',
                  gap: 4,
                }}
              >
                {artist.genres.slice(0, 5).map((genre) => (
                  <span
                    key={genre}
                    style={{
                      fontSize: 8,
                      fontFamily: 'Inter, sans-serif',
                      fontWeight: 500,
                      textTransform: 'uppercase',
                      background: '#141414',
                      border: '1px solid #1e1e1e',
                      color: '#444',
                      padding: '3px 7px',
                      borderRadius: 4,
                    }}
                  >
                    {genre}
                  </span>
                ))}
              </div>
            )}

            {/* Section header */}
            <div
              style={{
                padding: '0 16px 8px',
                fontSize: 9,
                fontFamily: 'Inter, sans-serif',
                fontWeight: 600,
                textTransform: 'uppercase',
                letterSpacing: '0.12em',
                color: 'var(--text-muted)',
              }}
            >
              Top Tracks
            </div>

            {/* Track list */}
            <div>
              {visibleTracks.map((track, i) => (
                <TrackRow
                  key={track.id}
                  track={track}
                  index={i}
                  isPlaying={currentTrack?.id === track.id}
                  onPlay={() => handlePlay(track)}
                />
              ))}
            </div>

            {/* Show more */}
            {hasMore && (
              <div style={{ padding: '4px 16px 8px' }}>
                <button
                  onClick={() => setShowMore(true)}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    padding: 0,
                    fontSize: 10,
                    fontFamily: 'Inter, sans-serif',
                    fontWeight: 400,
                    color: 'var(--text-muted)',
                    cursor: 'pointer',
                  }}
                >
                  Show more
                </button>
              </div>
            )}

            {/* Footer */}
            <div
              style={{
                padding: '12px 16px',
                borderTop: '1px solid var(--border)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginTop: 8,
              }}
            >
              {/* Open in Spotify */}
              <a
                href={spotifyUrl}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  textDecoration: 'none',
                  fontSize: 11,
                  fontFamily: 'Inter, sans-serif',
                  fontWeight: 400,
                  color: 'var(--text-muted)',
                }}
              >
                {/* Green dot */}
                <span
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: '50%',
                    background: '#1db954',
                    display: 'inline-block',
                    flexShrink: 0,
                  }}
                />
                Open in Spotify
              </a>

              {/* Not for me */}
              <button
                onClick={onDismissAndCollapse}
                style={{
                  background: 'transparent',
                  border: 'none',
                  padding: 0,
                  fontSize: 11,
                  fontFamily: 'Inter, sans-serif',
                  fontWeight: 400,
                  color: 'var(--text-muted)',
                  cursor: 'pointer',
                }}
              >
                👎 Not for me
              </button>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}
