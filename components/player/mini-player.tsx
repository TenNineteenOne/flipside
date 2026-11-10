"use client"

import { useEffect, useState, useSyncExternalStore, type CSSProperties } from "react"
import Image from "next/image"
import { Pause, Play, X } from "lucide-react"
import { useAudio } from "@/lib/audio-context"
import { readableTextOn, sanitizeHex } from "@/lib/color-utils"
import { artworkAt, letterFor } from "@/lib/feed/artwork"

// How many mounted components currently hide the floating pill: the docked
// player (the desktop feed's focus pane has its own player) and the phone feed
// (which shows its own small player bar). No route or width checks:
// suppressors only exist where those views render.
let suppressors = 0
const suppressListeners = new Set<() => void>()
const subscribeSuppressed = (l: () => void) => {
  suppressListeners.add(l)
  return () => { suppressListeners.delete(l) }
}

/** Hide the floating pill while mounted. */
export function useSuppressFloatingPlayer() {
  useEffect(() => {
    suppressors += 1
    suppressListeners.forEach((l) => l())
    return () => {
      suppressors -= 1
      suppressListeners.forEach((l) => l())
    }
  }, [])
}

/** `docked`: an in-page player (the desktop focus pane; the phone feed's bar). Default: the floating pill. */
export function MiniPlayer({ docked = false }: { docked?: boolean }) {
  return docked ? <DockedPlayer /> : <FloatingPlayer />
}

function DockedPlayer() {
  const { currentTrack, artistName, artistImageUrl, artistColor, isPlaying, progress, pause, resume } = useAudio()
  useSuppressFloatingPlayer()

  if (!currentTrack) {
    return (
      <div className="ev-player" data-idle>
        {/* feed.css shows one of the two: the key hint where there is a keyboard, the tap hint on touch. */}
        <span className="ev-player-idle ev-idle-keys">Nothing playing. Press <kbd className="ev-kbd">Space</kbd> to hear the selected artist.</span>
        <span className="ev-player-idle ev-idle-touch">Nothing playing. Tap play to hear the selected artist.</span>
      </div>
    )
  }
  const art = artistImageUrl || currentTrack.albumImageUrl
  return (
    <div className="ev-player" style={artistColor ? ({ "--a": artistColor } as CSSProperties) : undefined}>
      {art ? (
        <Image src={artworkAt(art, 40)} alt="" width={40} height={40} />
      ) : (
        <span className="ev-player-blank ev-letter" style={{ background: sanitizeHex(artistColor), color: readableTextOn(sanitizeHex(artistColor)) }} aria-hidden>
          {letterFor(artistName)}
        </span>
      )}
      <div className="ev-player-text">
        <span className="ev-player-track">{currentTrack.name}</span>
        <span className="ev-player-artist">{artistName}</span>
      </div>
      <button type="button" className="ev-player-btn" onClick={isPlaying ? pause : resume} aria-label={isPlaying ? "Pause" : "Play"}>
        {isPlaying ? <Pause size={18} fill="currentColor" strokeWidth={0} aria-hidden /> : <Play size={18} fill="currentColor" strokeWidth={0} aria-hidden />}
      </button>
      <span className="ev-player-bar" aria-hidden><span style={{ transform: `scaleX(${progress})` }} /></span>
    </div>
  )
}

function FloatingPlayer() {
  const audio = useAudio()
  const { pause, resume, stop } = audio
  const suppressed = useSyncExternalStore(subscribeSuppressed, () => suppressors > 0, () => false)
  const open = !!audio.currentTrack && !suppressed

  // The pill slides up from below the screen and leaves the same way, fading (globals.css,
  // .mini-player-pill). It stays mounted until its exit animation ends, showing what it showed
  // when it was closed (stop() clears the track), and comes back if reopened meanwhile.
  const [present, setPresent] = useState(open)
  if (open && !present) setPresent(true)
  const live = { currentTrack: audio.currentTrack, artistName: audio.artistName, artistColor: audio.artistColor, isPlaying: audio.isPlaying, progress: audio.progress }
  const [held, setHeld] = useState(live)
  if (open && (Object.keys(live) as (keyof typeof live)[]).some((k) => live[k] !== held[k])) setHeld(live)
  const { currentTrack, artistName, artistColor, isPlaying, progress } = open ? live : held

  const dynamicColor = artistColor && /^#[0-9a-fA-F]{6}$/.test(artistColor) ? artistColor : "#8b5cf6"

  return (
    <>
      {present && currentTrack && (
        <div
           data-state={open ? "open" : "closed"}
           onAnimationEnd={(e) => { if (!open && e.target === e.currentTarget) setPresent(false) }}
           inert={!open}
           className="mini-player-pill fixed bottom-0 left-1/2 z-50 w-[92%] max-w-[480px] overflow-hidden"
           style={{
             background: "var(--rail)",
             borderRadius: "24px",
             border: "1px solid rgba(255, 255, 255, 0.15)",
             boxShadow: "0 20px 40px rgba(0,0,0,0.8)",
           }}
        >
          {/* Progress Indicator pinned to TOP of the float card */}
          <div className="h-[3px] w-full bg-white/5 relative top-0">
            <div
              className="h-full absolute left-0"
              style={{ width: `${(progress * 100).toFixed(1)}%`, background: dynamicColor }}
            />
          </div>

          <div className="flex items-center gap-3 px-4 py-3">
            {/* Album art */}
            <div className="shrink-0 relative">
              {currentTrack.albumImageUrl ? (
                <Image
                  src={artworkAt(currentTrack.albumImageUrl, 48)}
                  alt={currentTrack.albumName}
                  width={48}
                  height={48}
                  className="size-12 object-cover shadow-lg"
                  style={{
                    borderRadius: 10,
                  }}
                  unoptimized
                />
              ) : (
                <div
                  className="size-12 rounded-[10px]"
                  style={{
                    background: "var(--raise)",
                    border: `2px solid ${dynamicColor}40`,
                  }}
                />
              )}
            </div>

            {/* Track info */}
            <div className="min-w-0 flex-1">
              <p className="truncate leading-tight font-bold text-[var(--fg)] text-[15px]">
                {currentTrack.name}
              </p>
              <p 
                className="truncate font-semibold text-[13px] mt-0.5"
                style={{ color: dynamicColor, filter: "brightness(1.5)" }} // Brighten dynamic color for readability
              >
                {artistName}
              </p>
            </div>

            {/* Controls */}
            <div className="flex shrink-0 items-center gap-2 pr-1">
              <button
                onClick={isPlaying ? pause : resume}
                aria-label={isPlaying ? "Pause" : "Play"}
                className="flex size-11 items-center justify-center rounded-full transition-transform hover:scale-105 active:scale-95 shadow-md"
                style={{ background: dynamicColor, color: "#000" }}
              >
                {isPlaying ? (
                  <Pause className="size-5" fill="currentColor" strokeWidth={0} />
                ) : (
                  <Play className="size-5" fill="currentColor" strokeWidth={0} />
                )}
              </button>
              
              <button
                onClick={stop}
                aria-label="Close player"
                className="flex size-9 items-center justify-center rounded-full transition-colors hover:bg-white/10 hover:text-[var(--fg)] ml-2 text-[var(--fg-3)]"
              >
                <X className="size-5" />
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
