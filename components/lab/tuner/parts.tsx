"use client"

import { Pause, Play } from "lucide-react"
import { PREVIEW_S, type Station } from "./radio"

/** Play/pause key wrapped in the 30-second countdown ring. */
export function RingButton({
  playing,
  buffering,
  progress,
  onClick,
  size = 88,
  label,
}: {
  playing: boolean
  buffering: boolean
  progress: number
  onClick: () => void
  size?: number
  label?: string
}) {
  const r = 46
  const c = 2 * Math.PI * r
  const left = Math.max(0, Math.ceil(PREVIEW_S * (1 - progress)))
  return (
    <button
      type="button"
      className="ring"
      style={{ width: size, height: size }}
      onClick={onClick}
      aria-label={label ?? (playing ? "Pause" : "Play")}
      aria-pressed={playing}
      data-buffering={buffering || undefined}
    >
      <svg viewBox="0 0 100 100" aria-hidden="true">
        <circle cx="50" cy="50" r={r} className="ring-track" />
        <circle
          cx="50"
          cy="50"
          r={r}
          className="ring-fill"
          strokeDasharray={c}
          strokeDashoffset={c * progress}
          transform="rotate(-90 50 50)"
        />
      </svg>
      <span className="ring-icon">{playing ? <Pause size={22} strokeWidth={2.25} /> : <Play size={22} strokeWidth={2.25} />}</span>
      <span className="ring-time tab" aria-hidden="true">
        0:{String(left).padStart(2, "0")}
      </span>
    </button>
  )
}

/** The "why", drawn as a signal chain: source artist → genre → this station. */
export function SignalPath({ s }: { s: Station }) {
  const src = s.artist.why.sourceArtists
  return (
    <p className="path">
      <span className="path-label">via</span>
      <span className="path-node">{src.join(" + ")}</span>
      <span className="path-hop">
        <span className="path-wire" aria-hidden="true" />
        <span className="path-node">{s.artist.why.genres[0] ?? s.artist.genres[0]}</span>
      </span>
      <span className="path-hop">
        <span className="path-wire" aria-hidden="true" />
        <span className="path-node path-out">{s.artist.name}</span>
      </span>
    </p>
  )
}

export const spotifyUrl = (name: string) => `https://open.spotify.com/search/${encodeURIComponent(name)}`

export async function shareStation(s: Station, onDone: (msg: string) => void) {
  const url = `${location.origin}/lab/tuner?station=${encodeURIComponent(s.artist.id)}`
  const text = `${s.artist.name} on Flipside FM ${s.freq.toFixed(1)}`
  try {
    if (navigator.share) {
      await navigator.share({ title: text, url })
      return
    }
    await navigator.clipboard.writeText(url)
    onDone("Station link copied")
  } catch (e) {
    if ((e as Error).name !== "AbortError") onDone("Couldn't share. Copy the address bar instead")
  }
}
