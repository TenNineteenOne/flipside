"use client"

import { useCallback, useEffect, useRef } from "react"
import { animate, motion, useMotionValue, useReducedMotion, useTransform, type PanInfo } from "framer-motion"
import { ArrowLeft, ArrowRight, ArrowUp, ExternalLink, Pause, Play, Share2, Undo2, X } from "lucide-react"
import type { LabArtist } from "@/lib/lab/artists"
import { useAudio } from "@/lib/audio-context"
import { inkOf, type Verdict } from "./drop-core"
import { Art, PosterName } from "./ink"

const THRESHOLD = 110
const EASE = [0.16, 1, 0.3, 1] as const

interface DeckProps {
  artist: LabArtist
  /** e.g. "Nº 218 · 2 of 5" */
  slot: string
  onDecide: (v: Verdict) => void
  onUndo?: () => void
  canUndo?: boolean
  compact?: boolean
}

/** One poster at a time. Drag it, press a button, or use the arrow keys. */
export function Deck({ artist, slot, onDecide, onUndo, canUndo, compact }: DeckProps) {
  const audio = useAudio()
  const reduce = useReducedMotion()
  const x = useMotionValue(0)
  const y = useMotionValue(0)
  const rotate = useTransform(x, [-300, 300], [-9, 9])
  const keepO = useTransform(x, [30, THRESHOLD], [0, 1])
  const keepS = useTransform(x, [30, THRESHOLD], [1.6, 1])
  const passO = useTransform(x, [-30, -THRESHOLD], [0, 1])
  const passS = useTransform(x, [-30, -THRESHOLD], [1.6, 1])
  const saveO = useTransform(y, [-30, -THRESHOLD], [0, 1])
  const saveS = useTransform(y, [-30, -THRESHOLD], [1.6, 1])
  const busy = useRef(false)

  const track = artist.topTracks[0]
  const mine = audio.currentTrack?.id === track?.id
  const playing = mine && audio.isPlaying
  const toggle = useCallback(() => {
    if (!track) return
    if (playing) audio.pause()
    else if (mine) audio.resume()
    else audio.play(track, artist.name, artist.imageUrl, artist.color)
  }, [audio, artist, track, mine, playing])

  const fling = useCallback(
    async (v: Verdict) => {
      if (busy.current) return
      busy.current = true
      if (!reduce && v !== "skip") {
        const dx = v === "keep" ? 1 : v === "pass" ? -1 : 0
        // stamp first, then the poster leaves
        // rAF stalls in background tabs; never let a decision hang on an animation
        const settle = (ms: number, ...a: { then: (f: () => void) => unknown }[]) => Promise.race([Promise.all(a.map((p) => new Promise<void>((r) => p.then(r)))), new Promise((r) => setTimeout(r, ms))])
        await settle(260, animate(x, dx * (THRESHOLD + 30), { duration: 0.16, ease: EASE }), animate(y, dx ? 0 : -(THRESHOLD + 30), { duration: 0.16, ease: EASE }))
        await settle(440, animate(x, dx * 900, { duration: 0.34, ease: EASE }), animate(y, dx ? 40 : -1100, { duration: 0.34, ease: EASE }))
      }
      onDecide(v)
    },
    [onDecide, reduce, x, y],
  )

  const onDragEnd = (_: unknown, info: PanInfo) => {
    const { x: ox, y: oy } = info.offset
    if (ox > THRESHOLD) fling("keep")
    else if (ox < -THRESHOLD) fling("pass")
    else if (oy < -THRESHOLD && Math.abs(oy) > Math.abs(ox)) fling("save")
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return
      const t = e.target instanceof Element ? e.target : null
      if (t?.closest("input, textarea, select, [contenteditable]")) return
      const map: Record<string, () => void> = {
        ArrowRight: () => fling("keep"),
        ArrowLeft: () => fling("pass"),
        ArrowUp: () => fling("save"),
        " ": toggle,
        z: () => canUndo && onUndo?.(),
      }
      const fn = map[e.key]
      if (!fn) return
      // let Space activate a focused button normally
      if (e.key === " " && t?.closest("button, a")) return
      e.preventDefault()
      fn()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [fling, toggle, onUndo, canUndo])

  const ink = inkOf(artist)
  const why = artist.why.sourceArtists
  const share = async () => {
    const text = `${artist.name}: ${artist.genres.join(", ")}. Found on Flipside.`
    try {
      if (navigator.share) await navigator.share({ title: artist.name, text, url: location.href })
      else await navigator.clipboard.writeText(`${text} ${location.href}`)
    } catch {}
  }

  return (
    <div className={`d-deck${compact ? " is-compact" : ""}`} style={{ ["--ink" as string]: ink }}>
      <motion.article
        className="d-poster"
        style={{ x, y, rotate }}
        drag
        dragSnapToOrigin
        dragElastic={0.9}
        onDragEnd={onDragEnd}
        initial={reduce ? false : { scale: 0.94, rotate: -2 }}
        animate={{ scale: 1, rotate: 0 }}
        transition={{ duration: 0.4, ease: EASE }}
        aria-label={`${artist.name}, ${slot}`}
      >
        <header className="d-poster-top">
          <span>{slot}</span>
          <span>{artist.genres[0]}</span>
        </header>
        <button type="button" className="d-art-btn" onClick={() => Math.abs(x.get()) + Math.abs(y.get()) < 6 && toggle()} aria-label={playing ? `Pause ${artist.name}` : `Play a preview of ${artist.name}`}>
          <Art artist={artist} eager />
          <span className="d-play" aria-hidden="true">{playing ? <Pause /> : <Play />}</span>
          {mine && <span className="d-progress" style={{ transform: `scaleX(${audio.progress})` }} aria-hidden="true" />}
          <motion.span className="d-stamp is-keep" style={{ opacity: keepO, scale: keepS }} aria-hidden="true">Keep</motion.span>
          <motion.span className="d-stamp is-pass" style={{ opacity: passO, scale: passS }} aria-hidden="true">Pass</motion.span>
          <motion.span className="d-stamp is-save" style={{ opacity: saveO, scale: saveS }} aria-hidden="true">Wall</motion.span>
        </button>
        <h2 className="d-poster-name"><PosterName name={artist.name} max={compact ? 96 : 150} /></h2>
        <p className="d-billing">
          {why.length ? <>For fans of <b>{why.join(" & ")}</b></> : <>Straight out of {artist.genres[0]}</>}
          {track && <span className="d-track"> · preview: “{track.name}”</span>}
        </p>
      </motion.article>

      <div className="d-controls" role="group" aria-label="Decide">
        <button type="button" className="d-btn is-pass" onClick={() => fling("pass")} aria-keyshortcuts="ArrowLeft">
          <ArrowLeft aria-hidden="true" /> Pass
        </button>
        <button type="button" className="d-btn is-play" onClick={toggle} aria-keyshortcuts="Space" aria-label={playing ? "Pause preview" : "Play preview"}>
          {playing ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />}
        </button>
        <button type="button" className="d-btn is-save" onClick={() => fling("save")} aria-keyshortcuts="ArrowUp">
          <ArrowUp aria-hidden="true" /> Wall
        </button>
        <button type="button" className="d-btn is-keep" onClick={() => fling("keep")} aria-keyshortcuts="ArrowRight">
          Keep <ArrowRight aria-hidden="true" />
        </button>
      </div>
      <div className="d-secondary">
        <button type="button" onClick={() => fling("skip")}><X aria-hidden="true" /> Not today</button>
        <a href={`https://open.spotify.com/search/${encodeURIComponent(artist.name)}`} target="_blank" rel="noreferrer"><ExternalLink aria-hidden="true" /> Spotify</a>
        <button type="button" onClick={share}><Share2 aria-hidden="true" /> Share</button>
        {onUndo && (
          <button type="button" onClick={onUndo} disabled={!canUndo} aria-keyshortcuts="z"><Undo2 aria-hidden="true" /> Undo</button>
        )}
      </div>
    </div>
  )
}
