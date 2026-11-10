"use client"
/* eslint-disable @next/next/no-img-element -- lab brief: plain <img> for mzstatic art under the CSP */

import { useState } from "react"
import { AnimatePresence, MotionConfig, motion } from "framer-motion"
import { Heart, Pause, Play, ThumbsDown } from "lucide-react"
import { labArtists } from "@/lib/lab/artists"
import { useAudio } from "@/lib/audio-context"
import { artistVars, duration, popularityLabel, whyText } from "./shared"

const PICKS = ["glassbeams", "yinyin", "mdoumoctar", "nalasinephro", "sessa", "pachyman"]
const STACK = PICKS.map((id) => labArtists.find((a) => a.id === id)!)
const EASE = [0.16, 1, 0.3, 1] as const

/** The landing hero: a real, playable slice of the feed. No account needed to listen. */
export function HeroStack() {
  const audio = useAudio()
  const [i, setI] = useState(0)
  const [dir, setDir] = useState<1 | -1>(1)
  const [liked, setLiked] = useState<string[]>([])
  const a = STACK[i % STACK.length]
  const owns = !!audio.currentTrack && a.topTracks.some((t) => t.id === audio.currentTrack!.id)
  const playing = owns && audio.isPlaying

  const toggle = (track = 0) => {
    const t = a.topTracks[track]
    if (audio.currentTrack?.id === t.id) { if (audio.isPlaying) audio.pause(); else audio.resume() }
    else audio.play(t, a.name, a.imageUrl, a.color)
  }

  const next = (like: boolean) => {
    const wasPlaying = playing
    if (like) setLiked((l) => [...l, a.name])
    setDir(like ? 1 : -1)
    const n = STACK[(i + 1) % STACK.length]
    setI(i + 1)
    if (wasPlaying) audio.play(n.topTracks[0], n.name, n.imageUrl, n.color)
  }

  return (
    <MotionConfig reducedMotion="user">
      <div className="ev-stack">
        <div className="ev-stack-behind" aria-hidden>
          {[2, 1].map((k) => {
            const b = STACK[(i + k) % STACK.length]
            return <img key={`${b.id}-${k}`} className={`ev-stack-ghost ev-stack-ghost-${k}`} src={b.imageUrl} alt="" width={600} height={600} />
          })}
        </div>
        <AnimatePresence mode="popLayout" initial={false} custom={dir}>
          <motion.article
            key={`${a.id}-${i}`}
            className="ev-stack-card"
            style={artistVars(a)}
            custom={dir}
            initial={{ opacity: 0, scale: 0.96, y: 14 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, x: dir * 120, rotate: dir * 4, transition: { duration: 0.26, ease: EASE } }}
            transition={{ duration: 0.32, ease: EASE }}
            aria-label={`${a.name}, ${a.genres.join(", ")}`}
          >
            <div className="ev-stack-media">
              <img src={a.imageUrl} alt={`${a.topTracks[0].albumName} cover art`} width={600} height={600} fetchPriority={i === 0 ? "high" : "auto"} />
              <button className="ev-stack-play" onClick={() => toggle()} aria-label={playing ? `Pause ${a.name}` : `Play ${a.name}`}>
                {playing ? <Pause size={26} fill="currentColor" strokeWidth={0} aria-hidden /> : <Play size={26} fill="currentColor" strokeWidth={0} aria-hidden />}
              </button>
              {owns && (
                <span className="ev-stack-progress" aria-hidden><span style={{ transform: `scaleX(${audio.progress})` }} /></span>
              )}
            </div>
            <div className="ev-stack-body">
              <div className="ev-stack-id">
                <h2 className="ev-stack-name">{a.name}</h2>
                <span className="ev-stack-pop">{popularityLabel(a.popularity)}</span>
              </div>
              <p className="ev-stack-why">{whyText(a)} · {a.genres[0]}</p>
              <button className="ev-stack-track" onClick={() => toggle()} data-current={owns || undefined}>
                <span className="ev-stack-track-name">{owns ? audio.currentTrack!.name : a.topTracks[0].name}</span>
                <span className="ev-stack-track-dur">{playing ? "playing" : `0:30 of ${duration(a.topTracks[0].durationMs)}`}</span>
              </button>
              <div className="ev-stack-triage">
                <button className="ev-tri" onClick={() => next(false)}>
                  <ThumbsDown size={16} strokeWidth={1.75} aria-hidden /><span>Less like this</span>
                </button>
                <button className="ev-tri ev-tri-like" onClick={() => next(true)}>
                  <Heart size={16} strokeWidth={1.75} aria-hidden /><span>More like this</span>
                </button>
              </div>
            </div>
          </motion.article>
        </AnimatePresence>
        <p className="ev-stack-note" aria-live="polite">
          {liked.length === 0
            ? `${STACK.length} artists in this sample. No account needed to listen.`
            : `Noted: more like ${liked.slice(-2).join(" and ")}. Pick a name and flipside keeps it.`}
        </p>
      </div>
    </MotionConfig>
  )
}
