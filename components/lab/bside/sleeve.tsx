"use client"
/* eslint-disable @next/next/no-img-element -- lab brief: plain <img> for CSP-allowed mzstatic art */

import { Bookmark, BookmarkCheck, ExternalLink, Pause, Play, Share2 } from "lucide-react"
import { labArtists, type LabArtist } from "@/lib/lab/artists"
import { useAudio } from "@/lib/audio-context"
import { themeVars } from "./color"

/** Catalogue number printed on the spine: crate position + how deep the cut is. */
export function catNo(a: LabArtist) {
  const i = labArtists.findIndex((x) => x.id === a.id)
  return `FS-${String((i + 1) * 100 + (100 - a.popularity)).padStart(4, "0")}`
}

export function duration(ms: number) {
  const s = Math.round(ms / 1000)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`
}

/** The "why", written the way a shop clerk would scribble it on the back. */
export function linerNote(a: LabArtist) {
  const [first, second] = a.why.sourceArtists
  const [g1, g2] = a.genres
  const lead = `If you wore out ${first}, flip this.`
  const i = labArtists.findIndex((x) => x.id === a.id)
  const tails = [
    second ? `Sits on the shelf between ${first} and ${second}, and somehow louder than both.` : `Somewhere between ${g1} and ${g2}, and it never sits still.`,
    `File it under ${g1}, then play it to someone who swears they don't like ${g2}.`,
    second ? `For the ${second} crowd too. Start with side A, track one.` : `Start with side A, track one. Then the rest of the side.`,
  ]
  return `${lead} ${tails[i % tails.length]}`
}

export const spotifyUrl = (a: LabArtist) => `https://open.spotify.com/search/${encodeURIComponent(a.name)}`

/** Play/pause one of an artist's tracks through the shared lab audio provider. */
export function useDeck() {
  const audio = useAudio()
  const toggle = (a: LabArtist, t = a.topTracks[0]) => {
    if (audio.currentTrack?.id === t.id) {
      if (audio.isPlaying) audio.pause()
      else audio.resume()
    } else audio.play(t, a.name, a.imageUrl, a.color)
  }
  const owns = (a: LabArtist) => !!audio.currentTrack && a.topTracks.some((t) => t.id === audio.currentTrack!.id)
  return { ...audio, toggle, owns }
}

interface SleeveProps {
  artist: LabArtist
  flipped: boolean
  onFlip: () => void
  held: boolean
  onHold: () => void
  onShare: () => void
  priority?: boolean
  /** Screenshot-only: render the vinyl out and mid-spin without real audio. */
  demoSpin?: boolean
}

export function Sleeve({ artist: a, flipped, onFlip, held, onHold, onShare, priority, demoSpin }: SleeveProps) {
  const deck = useDeck()
  const mine = deck.owns(a)
  const out = demoSpin || (mine && deck.progress < 1)
  const spinning = demoSpin || (mine && deck.isPlaying)
  const progress = demoSpin ? 0.38 : mine ? deck.progress : 0
  const backId = `bside-${a.id}`
  const R = 18
  const C = 2 * Math.PI * R

  return (
    <div className="bs-sleeve" style={themeVars(a)} data-flipped={flipped || undefined} data-out={out || undefined} data-spinning={spinning || undefined}>
      <div className="bs-disc" aria-hidden="true">
        <div className="bs-disc-spin">
          <div className="bs-label">
            <span>{a.name}</span>
            <small>{catNo(a)} · 33⅓</small>
          </div>
        </div>
        <svg className="bs-arc" viewBox="0 0 100 100">
          <circle cx="50" cy="50" r={R} strokeDasharray={`${C * progress} ${C}`} />
        </svg>
      </div>

      <div className="bs-flipper">
        <div className="bs-face bs-front" inert={flipped}>
          <img src={a.imageUrl} alt={`Cover art for ${a.name}`} width={600} height={600} loading={priority ? "eager" : "lazy"} draggable={false} />
          {held && <span className="bs-sticker">On hold</span>}
        </div>

        <section className="bs-face bs-back" id={backId} inert={!flipped} aria-label={`B-side: liner notes for ${a.name}`}>
          <header className="bs-back-head">
            <h3>{a.name}</h3>
            <span className="bs-cat">{catNo(a)}</span>
          </header>
          <p className="bs-fileunder">
            File under <strong>{a.genres[0]}</strong> / {a.genres[1]}
          </p>
          <p className="bs-liner">{linerNote(a)}</p>
          <ol className="bs-tracks" aria-label="Side A">
            {a.topTracks.map((t, i) => {
              const on = deck.currentTrack?.id === t.id && deck.isPlaying
              return (
                <li key={t.id}>
                  <button type="button" onClick={() => deck.toggle(a, t)} aria-pressed={on} aria-label={`${on ? "Pause" : "Play"} A${i + 1}, ${t.name}`}>
                    <span className="bs-side">A{i + 1}</span>
                    <span className="bs-title">{t.name}</span>
                    <span className="bs-dur">{duration(t.durationMs)}</span>
                    {on ? <Pause size={16} aria-hidden /> : <Play size={16} aria-hidden />}
                  </button>
                </li>
              )
            })}
          </ol>
          <footer className="bs-back-acts">
            <button type="button" onClick={onHold} aria-pressed={held}>
              {held ? <BookmarkCheck size={15} aria-hidden /> : <Bookmark size={15} aria-hidden />}
              {held ? "On hold" : "Hold"}
            </button>
            <a href={spotifyUrl(a)} target="_blank" rel="noreferrer">
              <ExternalLink size={15} aria-hidden /> Spotify
            </a>
            <button type="button" onClick={onShare}>
              <Share2 size={15} aria-hidden /> Share
            </button>
          </footer>
        </section>
      </div>

      <button type="button" className="bs-corner" onClick={onFlip} aria-expanded={flipped} aria-controls={backId} aria-label={flipped ? "Flip back to the cover (F)" : "Flip to the B-side (F)"}>
        <span aria-hidden>{flipped ? "A" : "B"}</span>
      </button>
    </div>
  )
}
