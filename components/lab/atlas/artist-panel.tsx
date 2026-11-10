"use client"
/* eslint-disable @next/next/no-img-element -- lab brief: plain <img> for CDN artwork */

import Link from "next/link"
import { useState } from "react"
import { Bookmark, BookmarkCheck, ExternalLink, Pause, Play, Share2, X, Ban, ArrowLeft } from "lucide-react"
import { useAudio } from "@/lib/audio-context"
import type { Entry, PinStatus } from "./use-atlas"

const mmss = (ms: number) => `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, "0")}`

interface Props {
  entry: Entry
  guest?: boolean
  status?: PinStatus
  saved?: boolean
  onBack?: () => void
  onPlant?: () => void
  onAvoid?: () => void
  onDismiss?: () => void
  onSave?: () => void
}

export function ArtistPanel({ entry, guest, status, saved, onBack, onPlant, onAvoid, onDismiss, onSave }: Props) {
  const { pin, artist } = entry
  const audio = useAudio()
  const [shared, setShared] = useState(false)
  const spotify = `https://open.spotify.com/search/${encodeURIComponent(artist.name)}`

  const share = async () => {
    const data = { title: artist.name, text: `${artist.name}: found on the flipside, ${pin.directions.toLowerCase()}.`, url: spotify }
    try {
      if (navigator.share) await navigator.share(data)
      else { await navigator.clipboard.writeText(`${data.text} ${data.url}`); setShared(true); setTimeout(() => setShared(false), 2200) }
    } catch { /* cancelled */ }
  }

  return (
    <article className="atlas-artist" aria-labelledby={`artist-${artist.id}`} style={{ ["--art" as string]: artist.color }}>
      <header className="atlas-artist-top">
        {onBack && (
          <button type="button" className="atlas-icon-btn" onClick={onBack} aria-label="Back to all pins">
            <ArrowLeft size={18} aria-hidden />
          </button>
        )}
        <span className="atlas-gridref">
          Grid <b>{pin.grid}</b>, in {pin.genre}
        </span>
      </header>

      <div className="atlas-artist-id">
        <img src={artist.imageUrl} alt={`${artist.name}, album artwork`} width={112} height={112} />
        <div>
          <h2 id={`artist-${artist.id}`}>{artist.name}</h2>
          <p className="atlas-artist-genres">{artist.genres.join(", ")}</p>
          {status === "flag" && <p className="atlas-flagged">Flag planted. This is your land now.</p>}
        </div>
      </div>

      <ol className="atlas-route" aria-label="Why this artist">
        <li className="from">
          <span className="mark" aria-hidden />
          <span><b>{pin.source}</b> <em>you know this</em></span>
        </li>
        <li className="leg">
          <span className="mark" aria-hidden />
          <span>{pin.directions.startsWith("Next door") ? "Right next door" : pin.directions.replace(` of ${pin.source}`, "")}, {pin.heading.split(": ")[1]}</span>
        </li>
        <li className="to">
          <span className="mark" aria-hidden />
          <span><b>{artist.name}</b>, in {pin.genre}</span>
        </li>
      </ol>

      <ul className="atlas-tracks" aria-label={`Previews by ${artist.name}`}>
        {artist.topTracks.map((t) => {
          const current = audio.currentTrack?.id === t.id
          const playing = current && audio.isPlaying
          return (
            <li key={t.id} data-current={current || undefined}>
              <button
                type="button"
                className="atlas-track"
                aria-pressed={playing}
                aria-label={`${playing ? "Pause" : "Play"} ${t.name}`}
                onClick={() => (playing ? audio.pause() : current ? audio.resume() : audio.play(t, artist.name, artist.imageUrl, artist.color))}
              >
                <span className="atlas-track-icon">{playing ? <Pause size={15} aria-hidden /> : <Play size={15} aria-hidden />}</span>
                <span className="atlas-track-name">
                  {t.name}
                  <small>{t.albumName}</small>
                </span>
                <span className="atlas-track-time">{mmss(t.durationMs)}</span>
                {current && <span className="atlas-track-progress" style={{ transform: `scaleX(${audio.progress})` }} aria-hidden />}
              </button>
            </li>
          )
        })}
      </ul>

      {guest ? (
        <div className="atlas-guest-cta">
          <p>Like it? Plant your flag and the map grows around what you keep.</p>
          <Link href="/sign-in?mode=new" className="atlas-btn atlas-btn-primary">Plant your flag</Link>
        </div>
      ) : (
        <>
          <div className="atlas-decide">
            <button type="button" className="atlas-btn atlas-btn-primary" onClick={onPlant} aria-pressed={status === "flag"} title="Shortcut: F">
              <svg viewBox="0 0 16 20" width="14" height="17" aria-hidden><path d="M2 20V1h1v1h11l-3 4 3 4H3v10z" fill="currentColor" /></svg>
              {status === "flag" ? "Flag planted" : "Plant a flag"}
            </button>
            <button type="button" className="atlas-btn" onClick={onAvoid} title="Shortcut: X">
              <Ban size={16} aria-hidden />
              Not this way
            </button>
          </div>
          <p className="atlas-decide-hint">A flag pulls more like this onto your map. &ldquo;Not this way&rdquo; fogs the area around it.</p>
          <div className="atlas-more">
            <button type="button" className="atlas-chip" onClick={onSave} aria-pressed={!!saved}>
              {saved ? <BookmarkCheck size={16} aria-hidden /> : <Bookmark size={16} aria-hidden />}
              {saved ? "Saved" : "Save"}
            </button>
            <a className="atlas-chip" href={spotify} target="_blank" rel="noreferrer">
              <ExternalLink size={16} aria-hidden />
              Spotify
            </a>
            <button type="button" className="atlas-chip" onClick={share}>
              <Share2 size={16} aria-hidden />
              {shared ? "Link copied" : "Share"}
            </button>
            <button type="button" className="atlas-chip" onClick={onDismiss}>
              <X size={16} aria-hidden />
              Dismiss
            </button>
          </div>
        </>
      )}
    </article>
  )
}
