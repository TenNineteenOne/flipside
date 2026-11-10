"use client"

import "./feed.css"
import { useEffect, useState } from "react"
import { Bookmark, Pause, Play, Share2 } from "lucide-react"
import { PlatformIcon } from "@/components/platform-icon"
import { Art, artistVar } from "@/components/feed/feed-desktop"
import { useAudio } from "@/lib/audio-context"
import { artworkFor } from "@/lib/feed/artwork"
import { listSeparator, whyParts } from "@/lib/feed/card-copy"
import { PLATFORM_META } from "@/lib/music-links"
import { useArtistTracks } from "@/lib/hooks/use-artist-tracks"
import type { FeedTriage } from "@/lib/hooks/use-feed-triage"
import type { CardArtist } from "@/lib/cards/card-artist"

const RING = 2 * Math.PI * 29

/**
 * One artist as a phone card (PRD #182 "Snap behaviour details"): artwork with
 * a 64px play button and 30-second ring, name, genres with save / open / share,
 * the why sentence, up to three track chips. Sized against the nearest size
 * container (a Snap page; the tablet stage in #193). Presentation only.
 */
export function SnapCard({ a, triage, eager = false }: { a: CardArtist; triage: FeedTriage; eager?: boolean }) {
  const tracks = triage.tracksOf(a)
  const playable = tracks.filter((t) => t.previewUrl).slice(0, 3)
  const playing = triage.isPlaying(a)
  const saved = triage.savedIds.has(a.id)
  const platform = PLATFORM_META[triage.musicPlatform]
  const why = whyParts(a.why)
  const art = artworkFor({ imageUrl: a.imageUrl, topTracks: tracks })
  const { currentTrack, progress } = useAudio()
  const mine = !!currentTrack && tracks.some((t) => t.id === currentTrack.id)
  // Artists that arrived without tracks fetch them once selected, as the desktop focus pane does.
  const fetchTracks = a.topTracks.length === 0 && a.id === triage.selectedId

  return (
    <article className="ev-m-card" style={artistVar(a)} aria-label={a.name}>
      <div className="ev-m-art">
        <Art a={a} src={art} size={600} className="ev-m-img" alt={`${tracks[0]?.albumName || a.name} cover art`} eager={eager} />
        <PlayRing a={a} playing={playing} progress={mine ? progress : 0} disabled={playable.length === 0} onClick={() => triage.togglePlay(a)} />
      </div>

      <div className="ev-m-info">
        <h2 className="ev-m-name">{a.name}</h2>
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
              const cur = currentTrack?.id === t.id
              const on = cur && playing
              return (
                <button key={t.id} type="button" className="ev-m-chip" data-current={cur || undefined} aria-pressed={on} aria-label={`${on ? "Pause" : "Play"} ${t.name}`} onClick={() => triage.playTrack(a, i)}>
                  {on ? <Pause size={11} fill="currentColor" strokeWidth={0} aria-hidden /> : <Play size={11} fill="currentColor" strokeWidth={0} aria-hidden />}
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
    </article>
  )
}

/** Fetches tracks for the selected artist (useArtistTracks) and shows the desktop pane's loading / none copy. */
function TrackFetch({ a, triage }: { a: CardArtist; triage: FeedTriage }) {
  const { tracks, isFetching } = useArtistTracks({ artistId: a.id, artistName: a.name, initialTracks: a.topTracks })
  const { addTracks } = triage
  useEffect(() => {
    if (tracks.length > 0) addTracks(a.id, tracks)
  }, [a.id, tracks, addTracks])
  // The fetch starts in the hook's effect (which runs before this one), so until this component has
  // committed (plus a tick) it is "loading", not "no preview". A fast response can settle before any render sees
  // isFetching, so watching for isFetching=true alone is not enough.
  const [started, setStarted] = useState(false)
  useEffect(() => {
    const t = setTimeout(() => setStarted(true), 0)
    return () => clearTimeout(t)
  }, [])
  return <p className="ev-m-chips ev-m-chips-note">{isFetching || !started ? "Loading tracks…" : "No preview available"}</p>
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
