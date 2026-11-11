"use client"

import "./feed.css"
import { useEffect, useRef, useState } from "react"
import { motion, useMotionValue, useReducedMotion, useTransform, type PanInfo } from "framer-motion"
import { Heart, ThumbsDown, X } from "lucide-react"
import { Art, artistVar, CardActions, TrackList } from "@/components/feed/feed-parts"
import { artworkFor } from "@/lib/feed/artwork"
import { listSeparator, whyParts } from "@/lib/feed/card-copy"
import { SWIPE_THRESHOLD, swipeDirection } from "@/lib/feed/swipe"
import { useArtistTracks } from "@/lib/hooks/use-artist-tracks"
import type { FeedTriage } from "@/lib/hooks/use-feed-triage"
import type { CardArtist } from "@/lib/cards/card-artist"

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
 * One artist as a phone / tablet card, in the desktop focus card's order: artwork filling the height
 * that is left, with the name and genres over its lower edge; the why sentence; the six-action icon
 * row (CardActions); up to three previews as rows (TrackList). Sized against the nearest size
 * container (a Snap page; the tablet stage). Presentation only.
 */
export function SnapCard({ a, triage, eager = false, enter = false }: {
  a: CardArtist; triage: FeedTriage; eager?: boolean
  /** Tablet stage: the card arrives with a small scale-up (never from transparent). */
  enter?: boolean
}) {
  const tracks = triage.tracksOf(a)
  const why = whyParts(a.why)
  const art = artworkFor({ imageUrl: a.imageUrl, topTracks: tracks })
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
        <div className="ev-m-title">
          <h2 className="ev-m-name">{a.name}</h2>
          {a.genres.length > 0 && <p className="ev-m-genres">{a.genres.join(" · ")}</p>}
        </div>
        <motion.div className="ev-m-verdict ev-m-verdict-more" style={{ opacity: sw.more }} aria-hidden>
          <span><Heart size={18} fill="currentColor" strokeWidth={0} />More like this</span>
        </motion.div>
        <motion.div className="ev-m-verdict ev-m-verdict-less" style={{ opacity: sw.less }} aria-hidden>
          <span><ThumbsDown size={18} strokeWidth={2} />Less like this</span>
        </motion.div>
        {v && <Badge v={v} />}
      </div>

      <div className="ev-m-info">
        {why && (
          <p className="ev-m-why" data-far={why.far}>
            {why.lead}
            {why.names.length > 0
              ? why.names.map((n, i) => <span key={n}>{listSeparator(i, why.names.length)}<strong>{n}</strong></span>)
              : why.genres.join(", ")}
          </p>
        )}
        <CardActions a={a} triage={triage} />
        {tracks.some((t) => t.previewUrl) ? (
          <TrackList a={a} triage={triage} tracks={tracks} />
        ) : fetchTracks ? (
          <TrackFetch a={a} triage={triage} />
        ) : (
          <p className="ev-tracks-empty">{a.topTracks.length === 0 ? "Loading tracks…" : "No preview available"}</p>
        )}
      </div>
    </motion.article>
  )
}

/** "Liked" / "Less like this" / "Dismissed" on a decided card. */
function Badge({ v }: { v: "liked" | "passed" | "dismissed" }) {
  if (v === "liked") return <span className="ev-m-liked"><Heart size={13} fill="currentColor" strokeWidth={0} aria-hidden />Liked</span>
  return (
    <span className="ev-m-judged">
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
  return <p className="ev-tracks-empty">{isFetching ? "Loading tracks…" : "No preview available"}</p>
}
