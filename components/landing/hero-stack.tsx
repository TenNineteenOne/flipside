"use client"

import { useEffect, useRef, useState, type CSSProperties, type MouseEvent } from "react"
import Image from "next/image"
import { Heart, Pause, Play, ThumbsDown } from "lucide-react"
import { useAudio, useAudioProgress } from "@/lib/audio-context"
import { formatDuration, listSeparator, popularityLabel, whyParts } from "@/lib/feed/card-copy"
import { artistVars, landingSample, type LandingArtist } from "@/lib/landing/sample"
import type { Track } from "@/lib/music-provider/types"

const STACK = landingSample.artists
// shortcut: iTunes previews are 30s and the provider exposes only a 0–1 fraction; read real duration if previews ever vary.
const PREVIEW_MS = 30_000

function toTrack(a: LandingArtist, i: number): Track {
  const t = a.tracks[i]
  return { ...t, spotifyTrackId: null, albumImageUrl: a.imageUrl, source: "itunes" }
}

/** What a card shows: live for the top card, frozen for one being thrown off. */
interface CardView {
  key: string
  a: LandingArtist
  first: boolean
  owns: boolean
  playing: boolean
  progress: number
  track: LandingArtist["tracks"][number]
}

/**
 * The landing hero: a real, playable slice of the feed.
 * A verdict throws the top card off (left for less, right for more: landing.css
 * `.ev-stack-leaving`, fading as it goes) while the next one settles in from slightly
 * smaller and lower (`.ev-stack-enter`). Reduced motion: the thrown card only fades.
 */
export function HeroStack() {
  const audio = useAudio()
  const [i, setI] = useState(0)
  /** Cards being thrown off, each removed when its animation ends. */
  const [leaving, setLeaving] = useState<(CardView & { dir: 1 | -1 })[]>([])
  /** The verdict button to focus on the next card: set only when the verdict came from the keyboard. */
  const [refocus, setRefocus] = useState<Verdict | null>(null)
  const a = STACK[i % STACK.length]
  const owns = !!audio.currentTrack && a.tracks.some((t) => t.id === audio.currentTrack!.id)
  const playing = owns && audio.isPlaying
  const track = owns ? a.tracks.find((t) => t.id === audio.currentTrack!.id)! : a.tracks[0]
  const progress = useAudioProgress(owns)
  const view: CardView = { key: `${a.id}-${i}`, a, first: i === 0, owns, playing, progress, track }

  const toggle = () => {
    if (owns) {
      if (audio.isPlaying) audio.pause()
      else audio.resume()
    } else audio.play(toTrack(a, 0), a.name, a.imageUrl, a.color)
  }

  const next = (like: boolean, fromKeyboard: boolean) => {
    setRefocus(fromKeyboard ? (like ? "more" : "less") : null)
    // Two clicks before a re-render throw the same card once.
    setLeaving((l) => (l.some((x) => x.key === view.key) ? l : [...l, { ...view, dir: like ? 1 : -1 }]))
    setI(i + 1)
    const n = STACK[(i + 1) % STACK.length]
    if (playing) audio.play(toTrack(n, 0), n.name, n.imageUrl, n.color)
  }

  return (
    <div className="ev-stack">
      <div className="ev-stack-behind" aria-hidden>
        {[2, 1].map((k) => {
          const b = STACK[(i + k) % STACK.length]
          return (
            <Image key={`${b.id}-${k}`} className={`ev-stack-ghost ev-stack-ghost-${k}`} src={b.imageUrl} alt="" width={600} height={600} loading="eager" decoding="async" />
          )
        })}
      </div>
      {leaving.map((v) => (
        <Card
          key={v.key}
          view={v}
          className="ev-stack-leaving"
          style={{ "--dir": v.dir } as CSSProperties}
          onAnimationEnd={() => setLeaving((l) => l.filter((x) => x.key !== v.key))}
        />
      ))}
      <Card key={view.key} view={view} className={view.first ? "" : "ev-stack-enter"} onToggle={toggle} onNext={next} focus={refocus} />
    </div>
  )
}

type Verdict = "less" | "more"

/**
 * A keyboard activation of the focused button (a click event with no pointer: detail 0). Pointer
 * users are never moved: their focus stays where the browser put it.
 */
const fromKeyboard = (e: MouseEvent<HTMLButtonElement>) => e.detail === 0 && document.activeElement === e.currentTarget

/**
 * One sample card. Without handlers it is a thrown card: inert and hidden from assistive tech.
 * `focus`: on mount, focus that verdict button (the previous card's was used from the keyboard,
 * and that card is now inert, so focus would otherwise fall to the page).
 */
function Card({ view, className, style, onToggle, onNext, onAnimationEnd, focus = null }: {
  view: CardView
  className: string
  style?: CSSProperties
  onToggle?: () => void
  onNext?: (like: boolean, fromKeyboard: boolean) => void
  onAnimationEnd?: () => void
  focus?: Verdict | null
}) {
  const { a, first, owns, playing, progress, track } = view
  const live = !!onToggle
  const lessRef = useRef<HTMLButtonElement>(null)
  const moreRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (focus) (focus === "more" ? moreRef : lessRef).current?.focus()
  }, [focus])
  const why = whyParts(a.why)
  return (
    <article
      className={`ev-stack-card ${className}`}
      style={{ ...artistVars(a), ...style }}
      aria-label={live ? `${a.name}, ${a.genres.join(", ")}` : undefined}
      aria-hidden={!live || undefined}
      inert={!live}
      onAnimationEnd={(e) => { if (e.target === e.currentTarget) onAnimationEnd?.() }}
    >
      <div className="ev-stack-media">
        <Image
          src={a.imageUrl}
          alt={`${a.tracks[0].albumName} cover art`}
          width={600}
          height={600}
          loading="eager"
          fetchPriority={first ? "high" : "auto"}
        />
        <button type="button" className="ev-stack-play" onClick={onToggle} aria-label={playing ? `Pause ${a.name}` : `Play ${a.name}`}>
          {playing ? (
            <Pause size={26} fill="currentColor" strokeWidth={0} aria-hidden />
          ) : (
            <Play size={26} fill="currentColor" strokeWidth={0} aria-hidden />
          )}
        </button>
        {owns && (
          <span className="ev-stack-progress" aria-hidden>
            <span style={{ transform: `scaleX(${progress})` }} />
          </span>
        )}
      </div>
      <div className="ev-stack-body">
        <div className="ev-stack-id">
          <h2 className="ev-stack-name">{a.name}</h2>
          <span className="ev-stack-pop">{popularityLabel(a.popularity)}</span>
        </div>
        <p className="ev-stack-why">
          {why && (
            <>
              {why.lead}
              {why.names.map((n, k) => (
                <span key={n}>
                  {listSeparator(k, why.names.length)}
                  <strong>{n}</strong>
                </span>
              ))}
              {why.genres.join(", ")}
              {" · "}
            </>
          )}
          {a.genres[0]}
        </p>
        <button type="button" className="ev-stack-track" onClick={onToggle} data-current={owns || undefined}>
          <span className="ev-stack-track-name">{track.name}</span>
          <span className="ev-stack-track-dur">
            {/* formatDuration returns "" for zero / missing: the elapsed time still reads 0:00, and no total means no "of". */}
            {owns ? formatDuration(progress * PREVIEW_MS) || "0:00" : "0:30"}
            {formatDuration(track.durationMs) && ` of ${formatDuration(track.durationMs)}`}
          </span>
        </button>
        <div className="ev-stack-triage">
          <button type="button" className="ev-tri" ref={lessRef} onClick={(e) => onNext?.(false, fromKeyboard(e))}>
            <ThumbsDown size={16} strokeWidth={1.75} aria-hidden />
            <span>Less like this</span>
          </button>
          <button type="button" className="ev-tri ev-tri-like" ref={moreRef} onClick={(e) => onNext?.(true, fromKeyboard(e))}>
            <Heart size={16} strokeWidth={1.75} aria-hidden />
            <span>More like this</span>
          </button>
        </div>
      </div>
    </article>
  )
}
