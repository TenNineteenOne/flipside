"use client"

import "./feed.css"
import type { CSSProperties } from "react"
import Link from "next/link"
import Image from "next/image"
import { artworkAt, artworkFor, letterFor } from "@/lib/feed/artwork"
import { readableTextOn, resolveArtistColor } from "@/lib/color-utils"
import type { FeedTriage } from "@/lib/hooks/use-feed-triage"
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
  const { counts, total, visible, signals } = triage
  const liked = visible.filter((a) => signals.get(a.id) === "thumbs_up").slice(0, 4)
  return (
    <div className="ev-end">
      {liked.length > 0 && (
        <div className="ev-end-art" aria-hidden>
          {liked.map((a) => <Art key={a.id} a={a} src={artworkFor(a)} size={96} className="ev-end-img" />)}
        </div>
      )}
      <h2 className="ev-end-title">You&rsquo;ve heard all {total}.</h2>
      <p className="ev-end-body">
        {counts.liked} liked, {counts.passed} less like this, {counts.dismissed} dismissed.
      </p>
      <div className="ev-end-actions">
        <LoadMore onLoadMore={onLoadMore} generating={generating} wander={wander} primary />
        <Link className="ev-btn ev-btn-ghost" href="/saved">Review saved</Link>
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
