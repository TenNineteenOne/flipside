"use client"

import "./feed.css"
import type { CSSProperties } from "react"
import Link from "next/link"
import Image from "next/image"
import { Bookmark, Heart, Pause, Play, Share2, ThumbsDown, X } from "lucide-react"
import { PlatformIcon } from "@/components/platform-icon"
import { useAudio } from "@/lib/audio-context"
import { artworkAt, artworkFor, letterFor } from "@/lib/feed/artwork"
import { chipColors, readableTextOn, resolveArtistColor } from "@/lib/color-utils"
import { formatDuration } from "@/lib/feed/card-copy"
import { PLATFORM_META } from "@/lib/music-links"
import type { FeedTriage } from "@/lib/hooks/use-feed-triage"
import { firstUndecided } from "@/lib/feed/triage-queue"
import type { CardArtist } from "@/lib/cards/card-artist"
import { WanderSwitch, wanderButton } from "@/components/feed/wander-switch"

// Pieces shared by the desktop, tablet and phone feeds, kept out of feed-desktop.tsx so the
// tablet and phone layout chunks don't carry the desktop layout.

/** Per-artist colour as `--a`; feed.css derives `--a-dark` / `--a-light` from it. */
export const artistVar = (a: CardArtist) => ({ "--a": resolveArtistColor(a.artistColor, a.name) }) as CSSProperties

/**
 * Artwork, or a colour panel with the first letter when there is none (never a broken image).
 * `size` is the display size: Apple artwork is fetched at 3x it up to 64px, else 2x (artworkAt). `priority`
 * marks the likely LCP image (the selected artist's art) as a high-priority fetch.
 */
export function Art({ a, src, size, className, alt = "", eager = false, priority = false }: {
  a: CardArtist; src: string | null; size: number; className: string; alt?: string; eager?: boolean; priority?: boolean
}) {
  if (!src) {
    const bg = resolveArtistColor(a.artistColor, a.name)
    return <span className={`${className} ev-letter`} style={{ background: bg, color: readableTextOn(bg) }} aria-hidden>{letterFor(a.name)}</span>
  }
  return (
    <Image
      className={className}
      src={artworkAt(src, size)}
      alt={alt}
      width={size}
      height={size}
      loading={eager ? "eager" : "lazy"}
      decoding={eager ? undefined : "async"}
      fetchPriority={priority ? "high" : undefined}
    />
  )
}

/** Wander farther (users.adventurous): one value for every switch in a layout, owned by FeedClient. */
export interface Wander {
  on: boolean
  /** Saves the setting only; the next Load more uses it. */
  toggle: () => void
}

/** Focus pane when nothing is left to decide (PRD "End of queue"). */
export function EndState({ triage, onLoadMore, generating, wander }: { triage: FeedTriage; onLoadMore: () => void; generating: boolean; wander: Wander }) {
  const { counts, total, visible, signals, remaining, ids, select } = triage
  const liked = visible.filter((a) => signals.get(a.id) === "thumbs_up").slice(0, 4)
  return (
    <div className="ev-end">
      {liked.length > 0 && (
        <div className="ev-end-art" aria-hidden>
          {liked.map((a) => <Art key={a.id} a={a} src={artworkFor(a)} size={96} className="ev-end-img" />)}
        </div>
      )}
      <h2 className="ev-end-title">{remaining > 0 ? `${remaining} not rated yet.` : <>You&rsquo;ve heard all {total}.</>}</h2>
      <p className="ev-end-body">
        {counts.liked} liked, {counts.passed} less like this, {counts.dismissed} dismissed.
      </p>
      <div className="ev-end-actions">
        <LoadMore onLoadMore={onLoadMore} generating={generating} wander={wander} primary />
        {remaining > 0
          ? <button type="button" className="ev-btn ev-btn-ghost" onClick={() => select(firstUndecided(ids, signals))}>Rate the rest</button>
          : <Link className="ev-btn ev-btn-ghost" href="/saved">Review saved</Link>}
      </div>
    </div>
  )
}

/**
 * "Load more artists" with the Wander farther switch beside it: the end state's primary button, and always
 * available at the end of the queue / Up next list (the queue header uses a shorter `label`). Rainbow while
 * Wander farther is on. While generating it is aria-disabled (not disabled), so keyboard focus stays on it;
 * clicks are ignored.
 */
export function LoadMore({ onLoadMore, generating, wander, primary = false, label = "Load more artists" }: {
  onLoadMore: () => void; generating: boolean; wander: Wander; primary?: boolean; label?: string
}) {
  return (
    <>
      <button
        type="button"
        className={`ev-btn ${primary ? "ev-btn-primary" : "ev-btn-ghost"}${wanderButton(wander.on)}`}
        onClick={generating ? undefined : onLoadMore}
        aria-disabled={generating || undefined}
      >
        {generating ? "Generating…" : label}
      </button>
      <WanderSwitch on={wander.on} onToggle={wander.toggle} />
    </>
  )
}

/**
 * The artist card's icon row (desktop focus card and the phone / tablet SnapCard): six even columns,
 * Less, Skip, More, then Save, Open in {platform}, Share, each an icon over a one-word label.
 */
export function CardActions({ a, triage }: { a: CardArtist; triage: FeedTriage }) {
  const liked = triage.signals.get(a.id) === "thumbs_up"
  const saved = triage.savedIds.has(a.id)
  const platform = PLATFORM_META[triage.musicPlatform]
  const judge = (signal: "thumbs_up" | "thumbs_down" | "skip") => triage.judge(a.id, signal, { toggle: true, advance: true })
  return (
    <div className="ev-card-actions">
      <div className="ev-triage" role="group" aria-label="Tell flipside what you think">
        <button type="button" className="ev-ib" onClick={() => judge("thumbs_down")} aria-label="Less like this" title="Less like this (X)">
          <ThumbsDown size={18} strokeWidth={1.75} aria-hidden /><span>Less</span>
        </button>
        <button type="button" className="ev-ib" onClick={() => judge("skip")} aria-label="Skip this artist" title="Dismiss (D)">
          <X size={18} strokeWidth={1.75} aria-hidden /><span>Skip</span>
        </button>
        <button type="button" className="ev-ib ev-ib-like" onClick={() => judge("thumbs_up")} aria-pressed={liked} aria-label={liked ? "Liked" : "More like this"} title="More like this (L)">
          <Heart size={18} strokeWidth={1.75} fill={liked ? "currentColor" : "none"} aria-hidden /><span>{liked ? "Liked" : "More"}</span>
        </button>
      </div>
      <div className="ev-secondary">
        <button type="button" className="ev-ib" onClick={() => triage.save(a)} aria-pressed={saved} aria-label={saved ? "Saved" : "Save for later"} title="Save for later (B)">
          <Bookmark size={18} strokeWidth={1.75} fill={saved ? "currentColor" : "none"} aria-hidden /><span>{saved ? "Saved" : "Save"}</span>
        </button>
        <a className="ev-ib" href={triage.artistLink(a)} target="_blank" rel="noopener noreferrer" aria-label={`Open in ${platform.label}`} title={`Open in ${platform.label} (O)`}>
          <PlatformIcon platform={triage.musicPlatform} size={18} /><span>{platform.label}</span>
        </a>
        <button type="button" className="ev-ib" onClick={() => void triage.share(a)} aria-label="Share" title="Share (S)">
          <Share2 size={18} strokeWidth={1.75} aria-hidden /><span>Share</span>
        </button>
      </div>
    </div>
  )
}

/** Up to three previews as full-width rows, each in its own colour (chipColors); the playing one shows its progress. */
export function TrackList({ a, triage, tracks }: { a: CardArtist; triage: FeedTriage; tracks: CardArtist["topTracks"] }) {
  const { progress } = useAudio()
  const playing = triage.isPlaying(a)
  const chips = chipColors(resolveArtistColor(a.artistColor, a.name))
  return (
    <section className="ev-tracks" aria-label="Previews">
      <ol>
        {tracks.filter((t) => t.previewUrl).slice(0, 3).map((t, i) => {
          const current = triage.isCurrentTrack(a, t)
          const on = current && playing
          const dur = formatDuration(t.durationMs)
          return (
            <li key={t.id}>
              <button type="button" className="ev-track" style={{ "--c": chips[i] } as CSSProperties} data-current={current || undefined} onClick={() => triage.playTrack(a, i)} aria-label={`${on ? "Pause" : "Play"} ${t.name}`}>
                <span className="ev-track-n" aria-hidden>
                  {on ? <Pause size={13} fill="currentColor" strokeWidth={0} /> : <Play size={13} fill="currentColor" strokeWidth={0} />}
                </span>
                <span className="ev-track-name">{t.name}<span className="ev-track-album">{t.albumName}</span></span>
                {dur && <span className="ev-track-dur">{dur}</span>}
                {current && <span className="ev-track-bar" aria-hidden><span style={{ transform: `scaleX(${progress})` }} /></span>}
              </button>
            </li>
          )
        })}
      </ol>
    </section>
  )
}
