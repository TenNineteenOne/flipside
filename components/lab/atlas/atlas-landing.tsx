"use client"

import Link from "next/link"
import { useEffect, useRef, useState } from "react"
import { X } from "lucide-react"
import { useAudio } from "@/lib/audio-context"
import { AtlasMap, type MapHandle } from "./atlas-map"
import { ArtistPanel } from "./artist-panel"
import { useAtlas } from "./use-atlas"
import type { AtlasSetup } from "./types"

export function AtlasLanding({ setup, demo }: { setup: AtlasSetup; demo?: string }) {
  const atlas = useAtlas(setup, 2)
  const map = useRef<MapHandle>(null)
  const audio = useAudio()
  const [narrow, setNarrow] = useState(false)
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 899px)")
    const on = () => setNarrow(mq.matches)
    on()
    mq.addEventListener("change", on)
    return () => mq.removeEventListener("change", on)
  }, [])

  const selected = atlas.entries.find((e) => e.pin.artistId === atlas.selectedId) ?? null

  // One tap: you hear them. No account, no second click.
  const open = (id: string, play = true) => {
    const e = atlas.entries.find((x) => x.pin.artistId === id)
    if (!e) return
    atlas.actions.select(id)
    const t = e.artist.topTracks[0]
    if (play && t) audio.play(t, e.artist.name, e.artist.imageUrl, e.artist.color)
  }
  useEffect(() => {
    if (demo === "artist") open("kokoroko", false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [demo])

  return (
    <div className="atlas-landing">
      <section className="atlas-hero" aria-labelledby="atlas-h1">
        <AtlasMap
          ref={map}
          setup={setup}
          pins={atlas.pins}
          flags={[]}
          avoid={[]}
          frontier={atlas.radius}
          selectedId={atlas.selectedId}
          onPin={(id) => open(id)}
          drift
          padLeft={narrow ? 0 : 520}
          padRight={selected && !narrow ? 420 : 0}
          padTop={56}
          className="atlas-hero-map"
          label="A live map of music. Drag to explore; tap a pin to hear an artist."
        />
        <header className="atlas-landing-top">
          <span className="atlas-wordmark">
            <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden><circle cx="12" cy="12" r="10.5" fill="none" stroke="currentColor" strokeWidth="2" /><path d="M12 4l3.2 8H8.8z" fill="#c8331c" /><path d="M12 20l-3.2-8h6.4z" fill="currentColor" /></svg>
            Flipside
          </span>
          <Link href="/sign-in" className="atlas-signin">Sign in</Link>
        </header>

        <div className="atlas-cartouche">
          <h1 id="atlas-h1">
            You are here.
            <span>The flipside is everything past the border.</span>
          </h1>
          <p className="atlas-lede">
            This is a map of 6,291 genres. The red ground is the music you already love. Every pin past it is an artist you&rsquo;ve
            probably never heard, with thirty seconds ready to play.
          </p>
          <div className="atlas-cta-row">
            <Link href="/sign-in?mode=new" className="atlas-btn atlas-btn-primary atlas-btn-lg">
              <svg viewBox="0 0 16 20" width="15" height="18" aria-hidden><path d="M2 20V1h1v1h11l-3 4 3 4H3v10z" fill="currentColor" /></svg>
              Plant your flag
            </Link>
            <p className="atlas-promise">No email. No password.<br />No listening history.</p>
          </div>
          <p className="atlas-try">
            Or tap a pin to listen now:{" "}
            {atlas.visible.slice(0, 3).map((e, i) => (
              <span key={e.pin.artistId}>
                {i > 0 && ", "}
                <button type="button" className="atlas-link" onClick={() => open(e.pin.artistId)}>{e.artist.name}</button>
              </span>
            ))}
            .
          </p>
        </div>

        {selected && (
          <aside className="atlas-guest" aria-label={selected.artist.name}>
            <button type="button" className="atlas-icon-btn atlas-guest-close" onClick={() => { atlas.actions.select(null); audio.pause() }} aria-label="Close">
              <X size={18} aria-hidden />
            </button>
            <ArtistPanel entry={selected} guest />
          </aside>
        )}
      </section>

      <section className="atlas-key" aria-labelledby="atlas-key-h">
        <div className="atlas-key-intro">
          <h2 id="atlas-key-h">How to read your map</h2>
          <p>
            Each of the 6,291 genres sits where it really sounds: electric to the west, acoustic to the east,
            spacious up north, bouncier down south. You start with a home turf. Flipside does the scouting.
          </p>
        </div>
        <dl className="atlas-key-list">
          <div>
            <dt><i className="sw-territory" />Your territory</dt>
            <dd>Built from a few artists you name. No history import, no tracking.</dd>
          </div>
          <div>
            <dt><i className="sw-pin" />A pin</dt>
            <dd>One artist just over your border, with directions from someone you know: &ldquo;2 regions east of Khruangbin&rdquo;.</dd>
          </div>
          <div>
            <dt><i className="sw-flag" />Plant a flag</dt>
            <dd>Keep what you like. The border moves out to meet it, and the next pins come from there.</dd>
          </div>
          <div>
            <dt><i className="sw-frontier" />The frontier</dt>
            <dd>Slide it out when you want strange. Pull it in when you want comfort.</dd>
          </div>
        </dl>
        <div className="atlas-key-cta">
          <Link href="/sign-in?mode=new" className="atlas-btn atlas-btn-primary atlas-btn-lg">Plant your flag</Link>
          <p>Takes a username. That&rsquo;s it.</p>
        </div>
      </section>
    </div>
  )
}
