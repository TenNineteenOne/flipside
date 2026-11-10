"use client"

import "./feed.css"
import { useEffect, useRef, useState, type CSSProperties } from "react"
import { motion, useMotionValue, useReducedMotion, useTransform, type PanInfo } from "framer-motion"
import { Bookmark, Heart, Pause, Play, Share2, ThumbsDown, X } from "lucide-react"
import { PlatformIcon } from "@/components/platform-icon"
import { Art, artistVar } from "@/components/feed/feed-parts"
import { useAudio } from "@/lib/audio-context"
import { chipColors, resolveArtistColor } from "@/lib/color-utils"
import { artworkFor } from "@/lib/feed/artwork"
import { listSeparator, whyParts } from "@/lib/feed/card-copy"
import { SWIPE_THRESHOLD, swipeDirection } from "@/lib/feed/swipe"
import { PLATFORM_META } from "@/lib/music-links"
import { useArtistTracks } from "@/lib/hooks/use-artist-tracks"
import type { FeedTriage } from "@/lib/hooks/use-feed-triage"
import type { CardArtist } from "@/lib/cards/card-artist"

const RING = 2 * Math.PI * 29
const VERDICT: Record<string, "liked" | "passed" | "dismissed"> = { thumbs_up: "liked", thumbs_down: "passed", skip: "dismissed" }

/**
 * Horizontal swipe on a card that stays where it is (the scroller moves on):
 * a release past the threshold commits at once and the card springs back to
 * rest (dragSnapToOrigin); it ignores new drags until it is back. A cancelled
 * pointer (the browser took the gesture over, a call came in) never commits:
 * framer-motion ends the drag on pointercancel like on pointerup, so the
 * cancel is noted first (React's listener runs before framer's window one).
 * Reduced motion: no rotation, no spring, the card jumps back.
 */
function useSwipe(onCommit: (dir: 1 | -1) => void) {
  const reduce = !!useReducedMotion()
  const x = useMotionValue(0)
  const rotate = useTransform(x, [-240, 240], [-7, 7])
  const more = useTransform(x, [24, SWIPE_THRESHOLD], [0, 1])
  const less = useTransform(x, [-24, -SWIPE_THRESHOLD], [0, 1])
  const [busy, setBusy] = useState(false)
  const cancelled = useRef(false)
  const onDragEnd = (_: unknown, info: PanInfo) => {
    const dir = cancelled.current ? null : swipeDirection(info.offset.x, info.velocity.x)
    cancelled.current = false
    if (reduce) x.jump(0)
    else if (dir) setBusy(true)
    if (dir) onCommit(dir)
  }
  return {
    reduce,
    // touch-action is in feed.css (pan-y pinch-zoom): framer-motion's inline pan-y would block pinch-zoom.
    style: { x, rotate: reduce ? 0 : rotate },
    onPointerDown: () => { cancelled.current = false },
    onCancel: () => { cancelled.current = true },
    drag: busy ? false : ("x" as const),
    dragSnapToOrigin: !reduce,
    onDragEnd,
    onDragTransitionEnd: () => setBusy(false),
    more,
    less,
  }
}

/**
 * One artist as a phone card (PRD #182 "Snap behaviour details"): artwork with
 * a 64px play button and 30-second ring, name, genres with save / open / share,
 * the why sentence, up to three track chips. Sized against the nearest size
 * container (a Snap page; the tablet stage in #193). Presentation only.
 */
export function SnapCard({ a, triage, eager = false, enter = false }: {
  a: CardArtist; triage: FeedTriage; eager?: boolean
  /** Tablet stage: the card arrives with a small scale-up (never from transparent). */
  enter?: boolean
}) {
  const tracks = triage.tracksOf(a)
  const playable = tracks.filter((t) => t.previewUrl).slice(0, 3)
  const chips = chipColors(resolveArtistColor(a.artistColor, a.name))
  const playing = triage.isPlaying(a)
  const saved = triage.savedIds.has(a.id)
  const platform = PLATFORM_META[triage.musicPlatform]
  const why = whyParts(a.why)
  const art = artworkFor({ imageUrl: a.imageUrl, topTracks: tracks })
  const { currentTrack, progress } = useAudio()
  const mine = !!currentTrack && triage.nowPlayingArtist?.id === a.id
  // Artists that arrived without tracks fetch them once selected, as the desktop focus pane does.
  const fetchTracks = a.topTracks.length === 0 && a.id === triage.selectedId

  const v = VERDICT[triage.signals.get(a.id) ?? ""]
  const sw = useSwipe((dir) => triage.judge(a.id, dir > 0 ? "thumbs_up" : "thumbs_down", { toggle: false, advance: true }))

  return (
    <motion.article
      className="ev-m-card"
      data-v={v}
      style={{ ...artistVar(a), ...sw.style }}
      initial={enter && !sw.reduce ? { scale: 0.96 } : false}
      animate={{ scale: 1 }}
      transition={{ duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
      drag={sw.drag}
      dragDirectionLock
      dragMomentum={false}
      dragSnapToOrigin={sw.dragSnapToOrigin}
      onDragEnd={sw.onDragEnd}
      onDragTransitionEnd={sw.onDragTransitionEnd}
      onPointerDown={sw.onPointerDown}
      onPointerCancel={sw.onCancel}
      onTouchCancel={sw.onCancel}
      aria-label={`${a.name}. Swipe right for more like this, left for less.`}
    >
      <div className="ev-m-art">
        <Art a={a} src={art} size={600} className="ev-m-img" alt={`${tracks[0]?.albumName || a.name} cover art`} eager={eager} priority={eager} />
        <motion.div className="ev-m-verdict ev-m-verdict-more" style={{ opacity: sw.more }} aria-hidden>
          <span><Heart size={18} fill="currentColor" strokeWidth={0} />More like this</span>
        </motion.div>
        <motion.div className="ev-m-verdict ev-m-verdict-less" style={{ opacity: sw.less }} aria-hidden>
          <span><ThumbsDown size={18} strokeWidth={2} />Less like this</span>
        </motion.div>
        <PlayRing a={a} playing={playing} progress={mine ? progress : 0} disabled={playable.length === 0} onClick={() => triage.togglePlay(a)} />
        {v && <Badge v={v} />}
      </div>

      <div className="ev-m-info">
        <div className="ev-m-title">
          <h2 className="ev-m-name">{a.name}</h2>
          {/* Sideways (landscape) cards show the badge here instead: their artwork can be too small to hold it beside the play button. */}
          {v && <Badge v={v} side />}
        </div>
        <div className="ev-m-meta">
          <p className="ev-m-genres">{a.genres.join(" · ")}</p>
          <div className="ev-m-sec">
            <button type="button" className="ev-m-icon" onClick={() => triage.save(a)} aria-pressed={saved} aria-label={saved ? `Remove ${a.name} from Saved` : `Save ${a.name} for later`}>
              <Bookmark size={19} strokeWidth={1.75} fill={saved ? "currentColor" : "none"} aria-hidden />
            </button>
            <a className="ev-m-icon" href={triage.artistLink(a)} target="_blank" rel="noopener noreferrer" aria-label={`Open ${a.name} in ${platform.label}`}>
              <PlatformIcon platform={triage.musicPlatform} size={19} />
            </a>
            <button type="button" className="ev-m-icon" onClick={() => void triage.share(a)} aria-label={`Share ${a.name}`}>
              <Share2 size={19} strokeWidth={1.75} aria-hidden />
            </button>
          </div>
        </div>
        {why && (
          <p className="ev-m-why">
            {why.lead}
            {why.names.length > 0
              ? why.names.map((n, i) => <span key={n}>{listSeparator(i, why.names.length)}<strong>{n}</strong></span>)
              : why.genres.join(", ")}
          </p>
        )}
        {playable.length > 0 ? (
          <div className="ev-m-chips" role="group" aria-label="Previews">
            {playable.map((t, i) => {
              const cur = triage.isCurrentTrack(a, t)
              const on = cur && playing
              return (
                <button key={t.id} type="button" className="ev-m-chip" style={{ "--c": chips[i] } as CSSProperties} data-current={cur || undefined} aria-pressed={on} aria-label={`${on ? "Pause" : "Play"} ${t.name}`} onClick={() => triage.playTrack(a, i)}>
                  <span className="ev-m-chip-ico" aria-hidden>{on ? <Pause size={12} fill="currentColor" strokeWidth={0} /> : <Play size={12} fill="currentColor" strokeWidth={0} />}</span>
                  <span>{t.name}</span>
                </button>
              )
            })}
          </div>
        ) : fetchTracks ? (
          <TrackFetch a={a} triage={triage} />
        ) : (
          <p className="ev-m-chips ev-m-chips-note">{a.topTracks.length === 0 ? "Loading tracks…" : "No preview available"}</p>
        )}
      </div>
    </motion.article>
  )
}

/** "Liked" / "Less like this" / "Dismissed" on a decided card. */
function Badge({ v, side = false }: { v: "liked" | "passed" | "dismissed"; side?: boolean }) {
  const cls = side ? " ev-m-badge-side" : ""
  if (v === "liked") return <span className={`ev-m-liked${cls}`}><Heart size={13} fill="currentColor" strokeWidth={0} aria-hidden />Liked</span>
  return (
    <span className={`ev-m-judged${cls}`}>
      {v === "passed" ? <ThumbsDown size={13} aria-hidden /> : <X size={13} aria-hidden />}
      {v === "passed" ? "Less like this" : "Dismissed"}
    </span>
  )
}

/** Fetches tracks for the selected artist (useArtistTracks) and shows the desktop pane's loading / none copy. */
function TrackFetch({ a, triage }: { a: CardArtist; triage: FeedTriage }) {
  const { tracks, isFetching } = useArtistTracks({ artistId: a.id, artistName: a.name, initialTracks: a.topTracks })
  const { addTracks } = triage
  useEffect(() => {
    if (tracks.length > 0) addTracks(a.id, tracks)
  }, [a.id, tracks, addTracks])
  return <p className="ev-m-chips ev-m-chips-note">{isFetching ? "Loading tracks…" : "No preview available"}</p>
}

/** 64px play button on the artwork; the ring fills over the 30-second preview of this artist's track. */
function PlayRing({ a, playing, progress, disabled, onClick }: {
  a: CardArtist; playing: boolean; progress: number; disabled: boolean; onClick: () => void
}) {
  return (
    <button type="button" className="ev-m-play" onClick={onClick} disabled={disabled} aria-label={playing ? `Pause ${a.name}` : `Play ${a.name}`}>
      <svg className="ev-m-ring-svg" viewBox="0 0 64 64" aria-hidden>
        <circle cx="32" cy="32" r="29" className="ev-m-ring-bg" />
        <circle cx="32" cy="32" r="29" className="ev-m-ring" strokeDasharray={RING} strokeDashoffset={RING * (1 - progress)} />
      </svg>
      {playing ? <Pause size={24} fill="currentColor" strokeWidth={0} aria-hidden /> : <Play size={24} fill="currentColor" strokeWidth={0} aria-hidden />}
    </button>
  )
}
