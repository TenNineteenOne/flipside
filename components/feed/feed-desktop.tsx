"use client"

import "./feed.css"
import { useEffect, type CSSProperties } from "react"
import Link from "next/link"
import Image from "next/image"
import { AnimatePresence, motion, useReducedMotion } from "framer-motion"
import { Bookmark, Heart, Pause, Play, Share2, ThumbsDown, X } from "lucide-react"
import { PlatformIcon } from "@/components/platform-icon"
import { MiniPlayer } from "@/components/player/mini-player"
import { ColdStartBanner } from "@/components/feed/cold-start-banner"
import { Kbd } from "@/components/feed/feed-shortcuts"
import { ShellSlot } from "@/components/shell/shell-context"
import { useAudio } from "@/lib/audio-context"
import { artworkAt, artworkFor, letterFor } from "@/lib/feed/artwork"
import { formatDuration, listSeparator, popularityLabel, whyParts, whyText } from "@/lib/feed/card-copy"
import { PLATFORM_META } from "@/lib/music-links"
import { readableTextOn, resolveArtistColor } from "@/lib/color-utils"
import { useArtistTracks } from "@/lib/hooks/use-artist-tracks"
import type { FeedTriage } from "@/lib/hooks/use-feed-triage"
import type { CardArtist } from "@/lib/cards/card-artist"

const VERDICT: Record<string, string> = { thumbs_up: "liked", thumbs_down: "passed", skip: "dismissed" }
const EASE = [0.16, 1, 0.3, 1] as const
/** Passed/dismissed rows fade and slide out (opacity + transform only); the list then closes up. */
const ROW_EXIT = { opacity: 0, x: -32, transition: { duration: 0.2, ease: EASE } }

/** Per-artist colour as `--a`; feed.css derives `--a-dark` / `--a-light` from it. */
export const artistVar = (a: CardArtist) => ({ "--a": resolveArtistColor(a.artistColor, a.name) }) as CSSProperties

/**
 * Artwork, or a colour panel with the first letter when there is none (never a broken image).
 * `size` is the display size: Apple artwork is fetched at twice it (artworkAt). `priority`
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

/**
 * Desktop feed (≥900px): queue column + focus pane, filling the shell's main
 * area (the `shell-fill` class opts out of the 520px column; see shell.css).
 * Presentation only: every decision goes through the triage hook.
 */
interface FeedDesktopProps {
  triage: FeedTriage
  /** Cold-start banner input (shown until the listener has a few signals). */
  signalCount: number
  /** "Load more artists" (FeedClient's generate-more flow) and its in-flight state. */
  onLoadMore: () => void
  generating: boolean
}

export function FeedDesktop({ triage, signalCount, onLoadMore, generating }: FeedDesktopProps) {
  const { visible, selected, selectedId, signals, remaining, total, tuning } = triage
  const reduced = useReducedMotion()
  return (
    <div className="ev-feed ev-app shell-fill">
      {tuning.more.length + tuning.less.length > 0 && (
        <ShellSlot name="rail">
          <section className="ev-feed ev-tuning" aria-label="What flipside has learned this session">
            <h2 className="ev-rail-heading">Tuning</h2>
            {tuning.more.length > 0 && (
              <div className="ev-tune-group">
                <span className="ev-tune-label">Leaning toward</span>
                <ul className="ev-chips">{tuning.more.map((g) => <li key={g} className="ev-chip ev-chip-more" title={g}>{g}</li>)}</ul>
              </div>
            )}
            {tuning.less.length > 0 && (
              <div className="ev-tune-group">
                <span className="ev-tune-label">Leaning away</span>
                <ul className="ev-chips">{tuning.less.map((g) => <li key={g} className="ev-chip" title={g}>{g}</li>)}</ul>
              </div>
            )}
          </section>
        </ShellSlot>
      )}
      <main className="ev-queue" aria-labelledby="ev-queue-title">
        <header className="ev-queue-head">
          <div>
            <h1 id="ev-queue-title" className="ev-queue-title">Today&rsquo;s flipside</h1>
            <p className="ev-queue-sub">{total} artists you&rsquo;ve never played, picked from what you told us.</p>
          </div>
          <div className="ev-progress" aria-label={`${remaining} of ${total} left`}>
            <span className="ev-progress-text"><strong>{remaining}</strong> of {total} left</span>
            <ol className="ev-strip" aria-hidden>
              {triage.ids.map((id) => (
                <li key={id} className="ev-seg" data-v={VERDICT[signals.get(id) ?? ""] ?? "none"} data-sel={id === selectedId || undefined} />
              ))}
            </ol>
          </div>
        </header>

        <div className="ev-coldstart"><ColdStartBanner signalCount={signalCount} /></div>

        <ul className="ev-rows" aria-label="Artist queue">
          <AnimatePresence initial={false}>
          {visible.map((a, i) => {
            const sel = a.id === selectedId
            const liked = signals.get(a.id) === "thumbs_up"
            const playing = triage.isPlaying(a)
            return (
              <motion.li
                key={a.id}
                id={`ev-row-${a.id}`}
                className="ev-row"
                data-sel={sel || undefined}
                data-liked={liked || undefined}
                style={artistVar(a)}
                exit={reduced ? undefined : ROW_EXIT}
              >
                <button type="button" className="ev-row-select" onClick={() => triage.select(a.id)} aria-label={`Select ${a.name}`} aria-current={sel || undefined} />
                <button
                  type="button"
                  className="ev-row-art"
                  onClick={() => { triage.select(a.id); triage.togglePlay(a) }}
                  aria-label={playing ? `Pause ${a.name}` : `Play ${a.name}`}
                  data-playing={playing || undefined}
                >
                  <Art a={a} src={artworkFor(a)} size={48} className="ev-row-img" eager={i === 0} />
                  <span className="ev-row-art-icon" aria-hidden>
                    {playing ? <Pause size={16} fill="currentColor" strokeWidth={0} /> : <Play size={16} fill="currentColor" strokeWidth={0} />}
                  </span>
                </button>
                <div className="ev-row-text">
                  <span className="ev-row-name">
                    {a.name}
                    {playing && <span className="ev-eq" aria-label="Playing"><i /><i /><i /></span>}
                  </span>
                  <span className="ev-row-why">{whyText(a.why)}</span>
                </div>
                <span className="ev-row-genre">{a.genres[0]}</span>
                <span className="ev-row-pop" title={`Popularity ${a.popularity}/100`}>
                  <span className="ev-meter" aria-hidden><span style={{ width: `${a.popularity}%` }} /></span>
                  <span className="ev-row-pop-n">{a.popularity}</span>
                </span>
                <span className="ev-row-state">
                  {liked ? (
                    <span className="ev-liked-tag"><Heart size={13} fill="currentColor" strokeWidth={0} aria-hidden />Liked</span>
                  ) : triage.savedIds.has(a.id) ? (
                    <span className="ev-saved-tag"><Bookmark size={13} fill="currentColor" strokeWidth={0} aria-hidden />Saved</span>
                  ) : null}
                </span>
              </motion.li>
            )
          })}
          </AnimatePresence>
        </ul>
        {visible.length > 0 && remaining === 0 && <p className="ev-queue-foot">Queue clear. These are the ones you kept.</p>}
        <div className="ev-queue-more"><LoadMore onLoadMore={onLoadMore} generating={generating} /></div>
      </main>

      <section className="ev-focus" aria-live="polite" aria-label="Selected artist">
        <div className="ev-focus-scroll">
          {selected ? (
            <FocusCard key={selected.id} a={selected} triage={triage} />
          ) : (
            <EndState triage={triage} onLoadMore={onLoadMore} generating={generating} />
          )}
        </div>
        <MiniPlayer docked />
      </section>
    </div>
  )
}

function FocusCard({ a, triage }: { a: CardArtist; triage: FeedTriage }) {
  // Artists that arrived without tracks fetch them here, as the old card did (selected artist only).
  const { tracks, isFetching } = useArtistTracks({ artistId: a.id, artistName: a.name, initialTracks: a.topTracks })
  const { addTracks } = triage
  useEffect(() => {
    if (a.topTracks.length === 0 && tracks.length > 0) addTracks(a.id, tracks)
  }, [a.id, a.topTracks.length, tracks, addTracks])

  const liked = triage.signals.get(a.id) === "thumbs_up"
  const playing = triage.isPlaying(a)
  const canPlay = tracks.some((t) => t.previewUrl)
  const loading = !canPlay && isFetching
  const why = whyParts(a.why)
  const art = artworkFor({ imageUrl: a.imageUrl, topTracks: tracks })
  const { currentTrack, progress } = useAudio()
  const playable = tracks.filter((t) => t.previewUrl).slice(0, 3)
  const saved = triage.savedIds.has(a.id)
  const platform = PLATFORM_META[triage.musicPlatform]
  const judge = (signal: "thumbs_up" | "thumbs_down" | "skip") => triage.judge(a.id, signal, { toggle: true, advance: true })

  return (
    <article className="ev-card" style={artistVar(a)}>
      <div className="ev-card-hero">
        <Art a={a} src={art} size={600} className="ev-card-art" alt={`${tracks[0]?.albumName || a.name} cover art`} eager priority />
        <div className="ev-card-id">
          <h2 className="ev-card-name">{a.name}</h2>
          {a.genres.length > 0 && <p className="ev-card-genres">{a.genres.join(" · ")}</p>}
          {why && (
            <p className="ev-card-why">
              {why.lead}
              {why.names.length > 0
                ? why.names.map((n, i) => <span key={n}>{listSeparator(i, why.names.length)}<strong>{n}</strong></span>)
                : why.genres.join(", ")}
            </p>
          )}
          <p className="ev-card-pop">
            <span className="ev-meter" aria-hidden><span style={{ width: `${a.popularity}%` }} /></span>
            {popularityLabel(a.popularity)} · popularity {a.popularity}
          </p>
        </div>
      </div>

      <div className="ev-card-actions">
        <button type="button" className="ev-btn ev-btn-play" onClick={() => triage.togglePlay(a)} aria-pressed={playing} disabled={!canPlay}>
          {canPlay && (playing ? <Pause size={18} fill="currentColor" strokeWidth={0} aria-hidden /> : <Play size={18} fill="currentColor" strokeWidth={0} aria-hidden />)}
          {loading ? "Loading tracks…" : !canPlay ? "No preview available" : playing ? "Pause" : "Play preview"}
          {canPlay && <Kbd>Space</Kbd>}
        </button>

        <div className="ev-triage" role="group" aria-label="Tell flipside what you think">
          <button type="button" className="ev-tri" onClick={() => judge("thumbs_down")}>
            <ThumbsDown size={16} strokeWidth={1.75} aria-hidden /><span>Less like this</span>
          </button>
          <button type="button" className="ev-tri" onClick={() => judge("skip")}>
            <X size={16} strokeWidth={1.75} aria-hidden /><span>Dismiss</span>
          </button>
          <button type="button" className="ev-tri ev-tri-like" onClick={() => judge("thumbs_up")} aria-pressed={liked}>
            <Heart size={16} strokeWidth={1.75} fill={liked ? "currentColor" : "none"} aria-hidden />
            <span>{liked ? "Liked" : "More like this"}</span>
          </button>
        </div>

        <p className="ev-hints" aria-hidden>
          <span><Kbd>X</Kbd>less</span><span><Kbd>D</Kbd>dismiss</span><span><Kbd>L</Kbd>more</span>
          <span><Kbd>B</Kbd>save</span><span><Kbd>O</Kbd>open</span><span><Kbd>J</Kbd><Kbd>K</Kbd>move</span>
        </p>

        <div className="ev-secondary">
          <button type="button" className="ev-sec" onClick={() => triage.save(a)} aria-pressed={saved} title="Save for later (B)">
            <Bookmark size={16} strokeWidth={1.75} fill={saved ? "currentColor" : "none"} aria-hidden />
            <span>{saved ? "Saved" : "Save"}</span>
          </button>
          <a className="ev-sec" href={triage.artistLink(a)} target="_blank" rel="noopener noreferrer" aria-label={`Open in ${platform.label}`} title={`Open in ${platform.label} (O)`}>
            <PlatformIcon platform={triage.musicPlatform} size={16} /><span>{platform.label}</span>
          </a>
          <button type="button" className="ev-sec" onClick={() => void triage.share(a)} title="Share (S)">
            <Share2 size={16} strokeWidth={1.75} aria-hidden /><span>Share</span>
          </button>
        </div>
      </div>

      {playable.length > 0 && (
        <section className="ev-tracks" aria-label="Previews">
          <h3 className="ev-tracks-title">Previews <span>30 seconds each</span></h3>
          <ol>
            {playable.map((t, i) => {
              const current = currentTrack?.id === t.id
              const on = current && playing
              const dur = formatDuration(t.durationMs)
              return (
                <li key={t.id}>
                  <button type="button" className="ev-track" data-current={current || undefined} onClick={() => triage.playTrack(a, i)} aria-label={`${on ? "Pause" : "Play"} ${t.name}`}>
                    <span className="ev-track-n" aria-hidden>
                      {on ? <Pause size={13} fill="currentColor" strokeWidth={0} /> : <span className="ev-track-i">{i + 1}</span>}
                      {!on && <Play className="ev-track-hover" size={13} fill="currentColor" strokeWidth={0} />}
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
      )}
    </article>
  )
}

/** Focus pane when nothing is left to decide (PRD "End of queue"). */
export function EndState({ triage, onLoadMore, generating }: { triage: FeedTriage; onLoadMore: () => void; generating: boolean }) {
  const { counts, total, tuning, visible, signals } = triage
  const liked = visible.filter((a) => signals.get(a.id) === "thumbs_up").slice(0, 4)
  const lean = tuning.more.slice(0, 2)
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
        {lean.length > 0 && <> Tomorrow&rsquo;s batch leans toward <strong>{lean.join(" and ")}</strong>.</>}
      </p>
      <div className="ev-end-actions">
        <LoadMore onLoadMore={onLoadMore} generating={generating} primary />
        <Link className="ev-btn ev-btn-ghost" href="/saved">Review saved</Link>
      </div>
    </div>
  )
}

/** "Load more artists": the end state's primary button, and always available at the end of the queue / Up next list. */
export function LoadMore({ onLoadMore, generating, primary = false }: { onLoadMore: () => void; generating: boolean; primary?: boolean }) {
  return (
    <button type="button" className={`ev-btn ${primary ? "ev-btn-primary" : "ev-btn-ghost"}`} onClick={onLoadMore} disabled={generating}>
      {generating ? "Generating…" : "Load more artists"}
    </button>
  )
}
