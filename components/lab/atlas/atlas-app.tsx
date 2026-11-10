"use client"
/* eslint-disable @next/next/no-img-element -- lab brief: plain <img> for CDN artwork */

import Link from "next/link"
import { useCallback, useEffect, useRef, useState } from "react"
import { BarChart3, Bookmark, Compass, History, Map as MapIcon, Minus, Pause, Play, Plus, Settings, LocateFixed } from "lucide-react"
import { useAudio } from "@/lib/audio-context"
import { AtlasMap, type GenreHit, type MapHandle } from "./atlas-map"
import { ArtistPanel } from "./artist-panel"
import { GenreSearch } from "./genre-search"
import { RANGES, useAtlas } from "./use-atlas"
import type { AtlasSetup } from "./types"

const NAV = [
  { label: "Feed", icon: MapIcon, current: true },
  { label: "Explore", icon: Compass },
  { label: "History", icon: History },
  { label: "Saved", icon: Bookmark },
  { label: "Stats", icon: BarChart3 },
  { label: "Settings", icon: Settings },
]

type Snap = "peek" | "half" | "full"

function useNarrow() {
  const [narrow, setNarrow] = useState(false)
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 899px)")
    const on = () => setNarrow(mq.matches)
    on()
    mq.addEventListener("change", on)
    return () => mq.removeEventListener("change", on)
  }, [])
  return narrow
}

export function AtlasApp({ setup, demo }: { setup: AtlasSetup; demo?: string }) {
  const atlas = useAtlas(setup, 1)
  const { actions, selectedId } = atlas
  const map = useRef<MapHandle>(null)
  const search = useRef<HTMLInputElement>(null)
  const audio = useAudio()
  const narrow = useNarrow()
  const [genres, setGenres] = useState<GenreHit[]>([])
  const [highlight, setHighlight] = useState<GenreHit | null>(null)
  const [toast, setToast] = useState<{ text: string; undo?: () => void } | null>(null)
  const [snap, setSnap] = useState<Snap>("peek")
  const [vh, setVh] = useState(800)

  useEffect(() => {
    const on = () => setVh(window.innerHeight)
    on()
    window.addEventListener("resize", on)
    return () => window.removeEventListener("resize", on)
  }, [])
  const sheetH = { peek: 236, half: Math.round(vh * 0.56), full: Math.round(vh * 0.88) }[snap]

  const selected = atlas.entries.find((e) => e.pin.artistId === selectedId) ?? null

  const toastTimer = useRef(0)
  const say = (text: string, undo?: () => void) => {
    setToast({ text, undo })
    window.clearTimeout(toastTimer.current)
    toastTimer.current = window.setTimeout(() => setToast(null), 5000)
  }

  const open = useCallback((id: string) => {
    const e = atlas.entries.find((x) => x.pin.artistId === id)
    if (!e) return
    actions.select(id)
    setHighlight(null)
    if (narrow) setSnap("half")
    map.current?.flyTo(e.pin.x, e.pin.y, 0.2)
  }, [atlas.entries, actions, narrow])

  const plant = (id: string) => {
    const e = atlas.entries.find((x) => x.pin.artistId === id)!
    if (atlas.status[id] === "flag") { actions.unplant(id); return say(`Flag pulled up from ${e.pin.genre}.`) }
    actions.plant(id)
    say(`Flag planted. Your territory now reaches ${e.pin.genre}.`, () => actions.unplant(id))
  }
  const avoid = (id: string) => {
    const e = atlas.entries.find((x) => x.pin.artistId === id)!
    actions.avoid(id); actions.select(null)
    say(`Noted. Fewer pins out toward ${e.pin.genre}.`, () => actions.restore(id))
  }
  const dismiss = (id: string) => {
    const e = atlas.entries.find((x) => x.pin.artistId === id)!
    actions.dismiss(id); actions.select(null)
    say(`${e.artist.name} taken off the map.`, () => actions.restore(id))
  }
  const save = (id: string) => {
    const e = atlas.entries.find((x) => x.pin.artistId === id)!
    say(atlas.saved[id] ? `${e.artist.name} removed from Saved.` : `${e.artist.name} saved.`)
    actions.toggleSave(id)
  }

  // Screenshot states: ?demo=artist opens a pin with a flag already planted elsewhere.
  useEffect(() => {
    if (demo !== "artist" && demo !== "flag") return
    actions.plant("kokoroko")
    actions.toggleSave("sessa")
    if (demo === "artist") open("altıngun")
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [demo])

  // Keyboard shortcuts.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (!(t instanceof Element) || t.closest("input, textarea, select") || e.metaKey || e.ctrlKey || e.altKey) return
      const k = e.key.toLowerCase()
      const list = atlas.visible.map((x) => x.pin.artistId)
      if (k === "/") { e.preventDefault(); search.current?.focus() }
      else if (k === "escape") actions.select(null)
      else if (k === "j" || k === "k") {
        if (!list.length) return
        const i = selectedId ? list.indexOf(selectedId) : -1
        open(list[(i + (k === "j" ? 1 : -1) + list.length) % list.length])
      } else if (k === "h") map.current?.home()
      else if (k === " " && audio.currentTrack && !t.closest("button, a")) { e.preventDefault(); if (audio.isPlaying) audio.pause(); else audio.resume() }
      else if (!selectedId) return
      else if (k === "f") plant(selectedId)
      else if (k === "x") avoid(selectedId)
      else if (k === "s") save(selectedId)
      else if (k === "d") dismiss(selectedId)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  })

  const jump = (g: GenreHit) => { setHighlight(g); map.current?.flyTo(g.x, g.y, 0.55) }
  const coastGenres = setup.coast.length / 2

  const list = (
    <section className="atlas-list" aria-labelledby="atlas-list-h">
      <div className="atlas-range">
        <label htmlFor="atlas-range">
          <span>How far out?</span>
          <b>{RANGES[atlas.range].label}</b>
        </label>
        <input id="atlas-range" type="range" min={0} max={RANGES.length - 1} step={1} value={atlas.range}
          onChange={(e) => actions.setRange(Number(e.target.value))}
          aria-valuetext={`${RANGES[atlas.range].label}, ${RANGES[atlas.range].r} regions from home`} />
        <div className="atlas-range-ticks" aria-hidden>{RANGES.map((r, i) => <i key={r.label} data-on={i <= atlas.range || undefined} />)}</div>
      </div>
      <h2 id="atlas-list-h">
        {atlas.visible.length} pins past your border
      </h2>
      <ul className="atlas-pinlist">
        {atlas.visible.map(({ pin, artist }) => (
          <li key={pin.artistId}>
            <button type="button" onClick={() => open(pin.artistId)} data-state={atlas.status[pin.artistId]} aria-current={pin.artistId === selectedId || undefined}>
              <img src={artist.imageUrl} alt="" width={44} height={44} loading="lazy" />
              <span>
                <b>{artist.name}</b>
                <small>{pin.directions}</small>
              </span>
              <span className="atlas-pinlist-ref">{atlas.status[pin.artistId] === "flag" ? "Flag" : pin.grid}</span>
            </button>
          </li>
        ))}
      </ul>
      {atlas.uncharted > 0 && (
        <p className="atlas-uncharted">
          {atlas.uncharted} more {atlas.uncharted === 1 ? "pin waits" : "pins wait"} past your frontier.{" "}
          <button type="button" className="atlas-link" onClick={() => actions.setRange(Math.min(RANGES.length - 1, atlas.range + 1))}>Look further out</button>
        </p>
      )}
      <dl className="atlas-legend" aria-label="Map legend">
        <div><dt><i className="sw-territory" /></dt><dd>Your territory: {coastGenres + atlas.flags.length * 6} genres you already live in</dd></div>
        <div><dt><i className="sw-landmark" /></dt><dd>Artists you know, used as landmarks</dd></div>
        <div><dt><i className="sw-frontier" /></dt><dd>Frontier: how far out you&rsquo;re looking</dd></div>
        <div><dt><i className="sw-contour" /></dt><dd>Contours: where genres crowd together</dd></div>
        <div><dt><i className="sw-axes" /></dt><dd>East is more acoustic, west more electric. North is spacious, south bouncier.</dd></div>
      </dl>
      <p className="atlas-keys">
        <kbd>J</kbd>/<kbd>K</kbd> next pin · <kbd>F</kbd> flag · <kbd>X</kbd> not this way · <kbd>S</kbd> save · <kbd>/</kbd> search · <kbd>H</kbd> home
      </p>
    </section>
  )

  const detail = selected && (
    <ArtistPanel
      key={selected.pin.artistId}
      entry={selected}
      status={atlas.status[selected.pin.artistId]}
      saved={atlas.saved[selected.pin.artistId]}
      onBack={() => actions.select(null)}
      onPlant={() => plant(selected.pin.artistId)}
      onAvoid={() => avoid(selected.pin.artistId)}
      onDismiss={() => dismiss(selected.pin.artistId)}
      onSave={() => save(selected.pin.artistId)}
    />
  )

  const player = audio.currentTrack && (
    <div className="atlas-player" style={{ ["--art" as string]: audio.artistColor ?? "#16202c" }}>
      {audio.artistImageUrl && <img src={audio.artistImageUrl} alt="" width={44} height={44} />}
      <span className="atlas-player-text">
        <b>{audio.currentTrack.name}</b>
        <small>{audio.artistName}</small>
      </span>
      <button type="button" className="atlas-icon-btn" onClick={() => (audio.isPlaying ? audio.pause() : audio.resume())} aria-label={audio.isPlaying ? "Pause preview" : "Play preview"}>
        {audio.isPlaying ? <Pause size={18} aria-hidden /> : <Play size={18} aria-hidden />}
      </button>
      <i className="atlas-player-progress" style={{ transform: `scaleX(${audio.progress})` }} aria-hidden />
    </div>
  )

  return (
    <div className="atlas-app" data-narrow={narrow || undefined}>
      <AtlasMap
        ref={map}
        setup={setup}
        pins={atlas.pins}
        flags={atlas.flags}
        avoid={atlas.avoid}
        frontier={atlas.radius}
        selectedId={selectedId}
        onPin={open}
        onGenres={setGenres}
        highlight={highlight}
        scrollZoom
        padRight={narrow ? 0 : 432}
        padTop={narrow ? 112 : 72}
        padBottom={narrow ? sheetH : 0}
        padLeft={narrow ? 0 : 20}
        className="atlas-app-map"
        label="Your music map. Drag to pan, scroll or pinch to zoom, arrow keys pan, plus and minus zoom. Pins are listed in the panel."
      >
        <div className="atlas-zoom">
          <button type="button" onClick={() => map.current?.zoomBy(1.6)} aria-label="Zoom in"><Plus size={18} aria-hidden /></button>
          <button type="button" onClick={() => map.current?.zoomBy(1 / 1.6)} aria-label="Zoom out"><Minus size={18} aria-hidden /></button>
          <button type="button" onClick={() => map.current?.home()} aria-label="Back to your territory"><LocateFixed size={18} aria-hidden /></button>
        </div>
      </AtlasMap>

      <header className="atlas-topbar">
        <Link href="/lab/atlas" className="atlas-wordmark" aria-label="Flipside home">
          <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden><circle cx="12" cy="12" r="10.5" fill="none" stroke="currentColor" strokeWidth="2" /><path d="M12 4l3.2 8H8.8z" fill="#c8331c" /><path d="M12 20l-3.2-8h6.4z" fill="currentColor" /></svg>
          Flipside
        </Link>
        <nav aria-label="Sections" className="atlas-nav">
          {NAV.map(({ label, icon: Icon, current }) => (
            <a key={label} href="#" aria-current={current ? "page" : undefined}>
              <Icon size={16} aria-hidden />
              <span>{label}</span>
            </a>
          ))}
        </nav>
        <GenreSearch ref={search} genres={genres} onJump={jump} />
      </header>

      {narrow ? (
        <Sheet height={sheetH} snap={snap} setSnap={setSnap} vh={vh}>
          {player}
          {detail || list}
        </Sheet>
      ) : (
        <>
          <aside className="atlas-side" aria-label={selected ? `${selected.artist.name}` : "Pins on your map"}>{detail || list}</aside>
          {player}
        </>
      )}

      <div className="atlas-toast" role="status" aria-live="polite">
        {toast && (
          <p>
            {toast.text}
            {toast.undo && <button type="button" onClick={() => { toast.undo!(); setToast(null) }}>Undo</button>}
          </p>
        )}
      </div>
    </div>
  )
}

function Sheet({ height, snap, setSnap, vh, children }: { height: number; snap: Snap; setSnap: (s: Snap) => void; vh: number; children: React.ReactNode }) {
  const el = useRef<HTMLDivElement>(null)
  const drag = useRef<{ y: number; h: number } | null>(null)
  const dragged = useRef(false)
  const full = Math.round(vh * 0.88)
  const place = (h: number) => { if (el.current) el.current.style.transform = `translate3d(0, ${full - h}px, 0)` }
  useEffect(() => place(height))
  const snaps: [Snap, number][] = [["peek", 236], ["half", Math.round(vh * 0.56)], ["full", full]]
  return (
    <div ref={el} className="atlas-sheet" style={{ height: full, transform: `translate3d(0, ${full - height}px, 0)` }}>
      <button
        type="button"
        className="atlas-sheet-handle"
        aria-label={snap === "full" ? "Collapse panel" : "Expand panel"}
        onClick={() => { if (dragged.current) { dragged.current = false; return } setSnap(snap === "peek" ? "half" : snap === "half" ? "full" : "peek") }}
        onPointerDown={(e) => { drag.current = { y: e.clientY, h: height }; e.currentTarget.setPointerCapture(e.pointerId); el.current?.setAttribute("data-dragging", "") }}
        onPointerMove={(e) => { if (drag.current) place(Math.max(120, Math.min(full, drag.current.h + drag.current.y - e.clientY))) }}
        onPointerUp={(e) => {
          const d = drag.current
          drag.current = null
          el.current?.removeAttribute("data-dragging")
          if (!d || Math.abs(e.clientY - d.y) < 6) return
          dragged.current = true
          const h = d.h + d.y - e.clientY
          const next = snaps.reduce((a, b) => (Math.abs(b[1] - h) < Math.abs(a[1] - h) ? b : a))[0]
          if (next === snap) place(height)
          else setSnap(next)
          e.preventDefault()
        }}
      >
        <i aria-hidden />
      </button>
      <div className="atlas-sheet-body">{children}</div>
    </div>
  )
}
