"use client"

import { useState } from "react"
import Image from "next/image"
import { AnimatePresence, MotionConfig, motion } from "framer-motion"
import { Heart, Pause, Play, ThumbsDown } from "lucide-react"
import { useAudio } from "@/lib/audio-context"
import { formatDuration, listSeparator, popularityLabel, whyParts } from "@/lib/feed/card-copy"
import { artistVars, landingSample, type LandingArtist } from "@/lib/landing/sample"
import type { Track } from "@/lib/music-provider/types"

const STACK = landingSample.artists
const EASE = [0.16, 1, 0.3, 1] as const
// shortcut: iTunes previews are 30s and the provider exposes only a 0–1 fraction; read real duration if previews ever vary.
const PREVIEW_MS = 30_000

function toTrack(a: LandingArtist, i: number): Track {
  const t = a.tracks[i]
  return { ...t, spotifyTrackId: null, albumImageUrl: a.imageUrl, source: "itunes" }
}

/** The landing hero: a real, playable slice of the feed. No account needed to listen. */
export function HeroStack() {
  const audio = useAudio()
  const [i, setI] = useState(0)
  const [dir, setDir] = useState<1 | -1>(1)
  const [liked, setLiked] = useState<string[]>([])
  const a = STACK[i % STACK.length]
  const owns = !!audio.currentTrack && a.tracks.some((t) => t.id === audio.currentTrack!.id)
  const playing = owns && audio.isPlaying
  const why = whyParts(a.why)
  const track = owns ? a.tracks.find((t) => t.id === audio.currentTrack!.id)! : a.tracks[0]

  const toggle = () => {
    if (owns) {
      if (audio.isPlaying) audio.pause()
      else audio.resume()
    } else audio.play(toTrack(a, 0), a.name, a.imageUrl, a.color)
  }

  const next = (like: boolean) => {
    if (like) setLiked((l) => [...l, a.name])
    setDir(like ? 1 : -1)
    setI(i + 1)
    const n = STACK[(i + 1) % STACK.length]
    if (playing) audio.play(toTrack(n, 0), n.name, n.imageUrl, n.color)
  }

  return (
    <MotionConfig reducedMotion="user">
      <div className="ev-stack">
        <div className="ev-stack-behind" aria-hidden>
          {[2, 1].map((k) => {
            const b = STACK[(i + k) % STACK.length]
            return (
              <Image key={`${b.id}-${k}`} className={`ev-stack-ghost ev-stack-ghost-${k}`} src={b.imageUrl} alt="" width={600} height={600} loading="eager" />
            )
          })}
        </div>
        <AnimatePresence mode="popLayout" initial={false} custom={dir}>
          <motion.article
            key={`${a.id}-${i}`}
            className="ev-stack-card"
            style={artistVars(a)}
            custom={dir}
            initial={{ scale: 0.96, y: 14 }}
            animate={{ scale: 1, y: 0 }}
            exit={{ opacity: 0, x: dir * 120, rotate: dir * 4, transition: { duration: 0.25, ease: EASE } }}
            transition={{ duration: 0.32, ease: EASE }}
            aria-label={`${a.name}, ${a.genres.join(", ")}`}
          >
            <div className="ev-stack-media">
              <Image
                src={a.imageUrl}
                alt={`${a.tracks[0].albumName} cover art`}
                width={600}
                height={600}
                loading="eager"
                fetchPriority={i === 0 ? "high" : "auto"}
              />
              <button type="button" className="ev-stack-play" onClick={toggle} aria-label={playing ? `Pause ${a.name}` : `Play ${a.name}`}>
                {playing ? (
                  <Pause size={26} fill="currentColor" strokeWidth={0} aria-hidden />
                ) : (
                  <Play size={26} fill="currentColor" strokeWidth={0} aria-hidden />
                )}
              </button>
              {owns && (
                <span className="ev-stack-progress" aria-hidden>
                  <span style={{ transform: `scaleX(${audio.progress})` }} />
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
              <button type="button" className="ev-stack-track" onClick={toggle} data-current={owns || undefined}>
                <span className="ev-stack-track-name">{track.name}</span>
                <span className="ev-stack-track-dur">
                  {/* formatDuration returns "" for zero / missing: the elapsed time still reads 0:00, and no total means no "of". */}
                  {owns ? formatDuration(audio.progress * PREVIEW_MS) || "0:00" : "0:30"}
                  {formatDuration(track.durationMs) && ` of ${formatDuration(track.durationMs)}`}
                </span>
              </button>
              <div className="ev-stack-triage">
                <button type="button" className="ev-tri" onClick={() => next(false)}>
                  <ThumbsDown size={16} strokeWidth={1.75} aria-hidden />
                  <span>Less like this</span>
                </button>
                <button type="button" className="ev-tri ev-tri-like" onClick={() => next(true)}>
                  <Heart size={16} strokeWidth={1.75} aria-hidden />
                  <span>More like this</span>
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
