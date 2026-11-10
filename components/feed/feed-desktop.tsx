"use client"

import "./feed.css"
import { useEffect, useRef, type CSSProperties } from "react"
import { Bookmark, Heart, Pause, Play, Share2, ThumbsDown, X } from "lucide-react"
import { PlatformIcon } from "@/components/platform-icon"
import { MiniPlayer } from "@/components/player/mini-player"
import { Art, artistVar, EndState, LoadMore, type Wander } from "@/components/feed/feed-parts"
import { WanderNote } from "@/components/feed/wander-switch"
import { ColdStartBanner } from "@/components/feed/cold-start-banner"
import { QueueColumns } from "@/components/feed/feed-skeleton"
import { Kbd } from "@/components/feed/feed-shortcuts"
import { ShellSlot } from "@/components/shell/shell-context"
import { useAudio } from "@/lib/audio-context"
import { chipColors, resolveArtistColor } from "@/lib/color-utils"
import { artworkFor } from "@/lib/feed/artwork"
import { formatDuration, listSeparator, popularityLabel, whyParts, whyText } from "@/lib/feed/card-copy"
import { PLATFORM_META } from "@/lib/music-links"
import { useArtistTracks } from "@/lib/hooks/use-artist-tracks"
import { useLeaving } from "@/lib/hooks/use-leaving"
import { useReducedMotion } from "@/lib/hooks/use-reduced-motion"
import type { FeedTriage } from "@/lib/hooks/use-feed-triage"
import type { CardArtist } from "@/lib/cards/card-artist"

const VERDICT: Record<string, string> = { thumbs_up: "liked", thumbs_down: "passed", skip: "dismissed" }
const rowKey = (a: CardArtist) => a.id

/**
 * Desktop feed (≥900px wide and ≥540px tall): queue column + focus pane, filling the shell's main
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
  /** Wander farther: the switches beside each Load more. */
  wander: Wander
  /** The weekly challenge strip (FeedClient's Suspense slot), shown under the header. */
  challenge?: React.ReactNode
  /** Called once this layout is mounted (FeedClient enables the keyboard shortcuts then). */
  onShown?: (layout: "phone" | "tablet" | "desktop") => void
}

export function FeedDesktop({ triage, signalCount, onLoadMore, generating, wander, challenge, onShown }: FeedDesktopProps) {
  useEffect(() => onShown?.("desktop"), [onShown])
  const { visible, selected, selectedId, signals, remaining, total, tuning } = triage
  // Passed/dismissed rows fade and slide out (feed.css, .ev-row[data-leaving]); the list then closes up.
  const rows = useLeaving(visible, rowKey, !useReducedMotion())
  // The column labels stick just under the (sticky, variable-height) queue header: feed.css reads its height.
  const headRef = useRef<HTMLElement>(null)
  useEffect(() => {
    const head = headRef.current
    if (!head?.parentElement) return
    const queue = head.parentElement
    const ro = new ResizeObserver(() => queue.style.setProperty("--ev-head-h", `${head.offsetHeight}px`))
    ro.observe(head)
    return () => ro.disconnect()
  }, [])
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
        <header ref={headRef} className="ev-queue-head">
          <div>
            <h1 id="ev-queue-title" className="ev-queue-title">Today&rsquo;s flipside</h1>
            <p className="ev-queue-sub">{total} artists you&rsquo;ve never played, picked from what you told us.</p>
          </div>
          <div className="ev-progress" aria-label={`${remaining} of ${total} left`}>
            <span className="ev-progress-text"><strong>{remaining}</strong> of {total} left</span>
            <ol className="ev-strip" aria-hidden style={{ "--n": triage.ids.length } as React.CSSProperties}>
              {triage.ids.map((id) => (
                <li key={id} className="ev-seg" data-v={VERDICT[signals.get(id) ?? ""] ?? "none"} data-sel={id === selectedId || undefined} />
              ))}
            </ol>
          </div>
          <div className="ev-wander-bar">
            <WanderNote on={wander.on} />
            <div className="ev-wander-ctl"><LoadMore onLoadMore={onLoadMore} generating={generating} wander={wander} label="Load more" primary /></div>
          </div>
        </header>

        {challenge}
        <div className="ev-coldstart"><ColdStartBanner signalCount={signalCount} /></div>

        {/* no labels floating above an emptied queue */}
        {rows.shown.length > 0 && <QueueColumns />}
        <ul className="ev-rows" aria-label="Artist queue">
          {rows.shown.map(({ item: a, leaving }, i) => {
            const sel = a.id === selectedId
            const liked = signals.get(a.id) === "thumbs_up"
            const playing = triage.isPlaying(a)
            return (
              <li
                key={a.id}
                id={leaving ? undefined : `ev-row-${a.id}`}
                className="ev-row"
                data-sel={(sel && !leaving) || undefined}
                data-liked={liked || undefined}
                data-leaving={leaving || undefined}
                inert={leaving}
                style={artistVar(a)}
                onAnimationEnd={leaving ? (e) => { if (e.target === e.currentTarget) rows.done(a.id) } : undefined}
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
                    <span className="ev-row-name-t">{a.name}</span>
                    {playing && <span className="ev-eq" aria-label="Playing"><i /><i /><i /></span>}
                  </span>
                  <span className="ev-row-why" data-far={whyParts(a.why)?.far}>{whyText(a.why)}</span>
                </div>
                <span className="ev-row-genre" title={a.genres[0]}>{a.genres[0] && <><span className="sr-only">Genre: </span>{a.genres[0]}</>}</span>
                <span className="ev-row-pop">
                  <span className="sr-only">Popularity: </span>
                  <span className="ev-meter" aria-hidden><span style={{ width: `${a.popularity}%` }} /></span>
                  <span className="ev-row-pop-n">{a.popularity}</span>
                  <span className="sr-only"> out of 100</span>
                </span>
                <span className="ev-row-state">
                  {liked ? (
                    <span className="ev-liked-tag"><Heart size={13} fill="currentColor" strokeWidth={0} aria-hidden />Liked</span>
                  ) : triage.savedIds.has(a.id) ? (
                    <span className="ev-saved-tag"><Bookmark size={13} fill="currentColor" strokeWidth={0} aria-hidden />Saved</span>
                  ) : null}
                </span>
              </li>
            )
          })}
        </ul>
        {visible.length > 0 && remaining === 0 && <p className="ev-queue-foot">Queue clear. These are the ones you kept.</p>}
        <div className="ev-queue-more"><LoadMore onLoadMore={onLoadMore} generating={generating} wander={wander} /></div>
      </main>

      <section className="ev-focus" aria-live="polite" aria-label="Selected artist">
        <div className="ev-focus-scroll">
          {selected ? (
            <FocusCard key={selected.id} a={selected} triage={triage} />
          ) : (
            <EndState triage={triage} onLoadMore={onLoadMore} generating={generating} wander={wander} />
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
  const { progress } = useAudio()
  const playable = tracks.filter((t) => t.previewUrl).slice(0, 3)
  const chips = chipColors(resolveArtistColor(a.artistColor, a.name))
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
            <p className="ev-card-why" data-far={why.far}>
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
      )}
    </article>
  )
}
