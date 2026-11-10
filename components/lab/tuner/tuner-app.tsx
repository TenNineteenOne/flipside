"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Ban, ChevronLeft, ChevronRight, ExternalLink, Share2, X } from "lucide-react"
import { Dial } from "./dial"
import { Scope } from "./scope"
import { RingButton, SignalPath, shareStation, spotifyUrl } from "./parts"
import { STATIONS, fmt, stationIndex, type Station } from "./radio"
import { useTuner } from "./use-tuner"

type Kind = "lock" | "skip" | "never" | "preset"
interface Entry {
  kind: Kind
  id: string
  at: number
  slot?: number
}
interface Prefs {
  locked: Set<string>
  skipped: Set<string>
  never: Set<string>
}
type Pick = Prefs & { played: Set<string> }

const NAV = ["Feed", "Explore", "History", "Saved", "Stats", "Settings"] as const
const VERB: Record<Kind, string> = { lock: "Locked in", skip: "Skipped", never: "Never again", preset: "Preset" }

const words = (s: Station) => new Set([...s.artist.genres.join(" ").split(/\s+/), ...s.artist.why.sourceArtists])
function sim(a: Station, b: Station) {
  const wa = words(a)
  let n = a.band === b.band ? 1 : 0
  for (const w of words(b)) if (wa.has(w)) n += 0.6
  return n
}
const byId = (id: string) => STATIONS[stationIndex(id)]

/** Lock in pulls the next station toward that sound; skip pushes away from it. */
function pick(cur: number, p: Pick): { i: number; why: string } {
  const pool = STATIONS.filter((s) => s.i !== cur && !p.never.has(s.artist.id))
  if (!pool.length) return { i: cur, why: "" }
  const fresh = pool.filter((s) => !p.played.has(s.artist.id))
  let best = { i: -1, score: -Infinity, why: "next on the dial" }
  for (const s of fresh.length ? fresh : pool) {
    let score = -((s.i - cur + STATIONS.length) % STATIONS.length) * 0.01
    let why = "next on the dial"
    let top = 0
    for (const id of p.locked) {
      const v = sim(s, byId(id)) * 2
      score += v
      if (v > top) [top, why] = [v, `close to ${byId(id).artist.name}, which you locked in`]
    }
    for (const id of p.skipped) score -= sim(s, byId(id)) * 1.5
    if (top === 0 && p.skipped.size && score > -0.5) why = "away from what you skipped"
    if (score > best.score) best = { i: s.i, score, why }
  }
  return best
}

const clock = (t: number) => new Date(t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hourCycle: "h23" })

export function TunerApp({ initialStation, demo }: { initialStation?: string; demo?: boolean }) {
  const [prefs, setPrefs] = useState<Prefs>(() => ({
    locked: new Set(demo ? ["yinyin", "glassbeams"] : []),
    skipped: new Set(demo ? ["sofiakourtesis"] : []),
    never: new Set(demo ? ["pachyman"] : []),
  }))
  const [presets, setPresets] = useState<(string | null)[]>(
    demo ? ["yinyin", "glassbeams", "nalasinephro", null, null, null] : [null, null, null, null, null, null],
  )
  const [log, setLog] = useState<Entry[]>(() => {
    if (!demo) return []
    const t0 = new Date(2026, 10, 9, 1, 4).getTime()
    return [
      { kind: "lock", id: "glassbeams", at: t0 + 9 * 60e3 },
      { kind: "preset", id: "glassbeams", at: t0 + 8 * 60e3, slot: 2 },
      { kind: "never", id: "pachyman", at: t0 + 6 * 60e3 },
      { kind: "skip", id: "sofiakourtesis", at: t0 + 3 * 60e3 },
      { kind: "lock", id: "yinyin", at: t0 + 60e3 },
    ]
  })
  const [toast, setToast] = useState("")

  const next = useCallback((cur: number, played: Set<string>) => pick(cur, { ...prefs, played }).i, [prefs])
  const t = useTuner(stationIndex(initialStation ?? (demo ? "kikagakumoyo" : "yinyin")), next, demo)
  const s = STATIONS[t.index]
  const id = s.artist.id
  const upNext = useMemo(() => pick(t.index, { ...prefs, played: t.played }), [t.index, prefs, t.played])

  useEffect(() => {
    if (!toast) return
    const h = setTimeout(() => setToast(""), 2600)
    return () => clearTimeout(h)
  }, [toast])

  const note = (kind: Kind, slot?: number) => setLog((l) => [{ kind, id, at: Date.now(), slot }, ...l].slice(0, 40))

  const tuneTo = (i: number, how: "drag" | "step" = "step") => {
    if (how === "step" && t.on) t.radio().blip()
    t.tune(i)
  }
  const step = (dir: number) => {
    let i = t.index
    for (let n = 0; n < STATIONS.length; n++) {
      i = (i + dir + STATIONS.length) % STATIONS.length
      if (!prefs.never.has(STATIONS[i].artist.id)) break
    }
    tuneTo(i)
  }
  const lockIn = () => {
    const on = !prefs.locked.has(id)
    const locked = new Set(prefs.locked)
    if (on) locked.add(id)
    else locked.delete(id)
    setPrefs({ ...prefs, locked })
    if (on) note("lock")
    setToast(on ? `Locked in. More like ${s.artist.name} next` : "Lock released")
  }
  const skip = () => {
    const p = { ...prefs, skipped: new Set(prefs.skipped).add(id) }
    setPrefs(p)
    note("skip")
    tuneTo(pick(t.index, { ...p, played: t.played }).i)
  }
  const never = () => {
    const p = { ...prefs, never: new Set(prefs.never).add(id) }
    setPrefs(p)
    setPresets((ps) => ps.map((x) => (x === id ? null : x)))
    note("never")
    setToast(`${fmt(s.freq)} is off your dial`)
    tuneTo(pick(t.index, { ...p, played: t.played }).i)
  }
  const preset = () => {
    const at = presets.indexOf(id)
    if (at >= 0) {
      setPresets(presets.map((x, k) => (k === at ? null : x)))
      setToast(`Preset ${at + 1} cleared`)
      return
    }
    const free = presets.indexOf(null)
    if (free < 0) return setToast("All six presets are set. Clear one first")
    setPresets(presets.map((x, k) => (k === free ? id : x)))
    note("preset", free)
    setToast(`Saved to preset ${free + 1}`)
  }
  const recall = (k: number) => {
    const pid = presets[k]
    if (pid) tuneTo(stationIndex(pid))
    else setToast(`Preset ${k + 1} is empty. Press B to save this station`)
  }

  const keys = { toggle: t.toggle, step, lockIn, skip, preset, recall }
  const keysRef = useRefLatest(keys)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return
      const el = e.target as HTMLElement
      if (el.closest("input, textarea, select, [contenteditable]")) return
      const k = keysRef.current
      const onButton = !!el.closest("button, a")
      if (e.key === " ") {
        if (onButton) return
        k.toggle()
      } else if (e.key === "ArrowRight") k.step(1)
      else if (e.key === "ArrowLeft") k.step(-1)
      else if (e.key === "l" || e.key === "L") k.lockIn()
      else if (e.key === "s" || e.key === "S") k.skip()
      else if (e.key === "b" || e.key === "B") k.preset()
      else if (/^[1-6]$/.test(e.key)) k.recall(Number(e.key) - 1)
      else return
      e.preventDefault()
    }
    addEventListener("keydown", onKey)
    return () => removeEventListener("keydown", onKey)
  }, [keysRef])

  const locked = prefs.locked.has(id)
  const presetAt = presets.indexOf(id)
  const tr = s.artist.topTracks[t.track]
  const nxt = STATIONS[upNext.i]

  return (
    <div className="tn-app" data-on={t.on || undefined}>
      <header className="plate-top">
        <a className="brand" href="/lab/tuner">
          Flipside <span>FM</span>
        </a>
        <nav className="selector" aria-label="Sections">
          {NAV.map((n) => (
            <a key={n} href="#" aria-current={n === "Feed" ? "page" : undefined}>
              <span className="led" aria-hidden="true" />
              {n === "Feed" ? "Tuner" : n}
            </a>
          ))}
        </nav>
        <p className="ident">
          <span className="onair" data-live={t.playing || undefined}>On air</span>
          <span className="who">@nightowl</span>
        </p>
      </header>

      <section className="dial-row" aria-label="Tuning">
        <Dial
          index={t.index}
          on={t.on}
          onTune={tuneTo}
          radio={t.radio}
          dead={prefs.never}
          marks={prefs.locked}
          presets={presets}
        />
      </section>

      <div className="deck">
        <main className="now">
          <p className="sr" aria-live="polite">
            {t.on ? `${fmt(s.freq)} FM, ${s.artist.name}` : ""}
          </p>
          <div className="now-head">
            {/* eslint-disable-next-line @next/next/no-img-element -- lab brief: plain <img> from the mzstatic CDN */}
            <img
              className="art"
              src={s.artist.imageUrl}
              alt={`${tr?.albumName ?? s.artist.name} cover art`}
              width={600}
              height={600}
              key={s.artist.imageUrl}
            />
            <div className="now-info">
              <p className="freq">
                <span className="tab freq-num">{fmt(s.freq)}</span>
                <span className="freq-unit">FM · {s.band}</span>
                {t.buffering && t.on && <span className="acq">Acquiring signal</span>}
              </p>
              <h1 className="artist">{s.artist.name}</h1>
              <p className="track">
                {tr?.name} <span>· {tr?.albumName}</span>
              </p>
              <SignalPath s={s} />
              <div className="tracks" role="group" aria-label="Track">
                {s.artist.topTracks.map((x, k) => (
                  <button
                    key={x.id}
                    type="button"
                    aria-pressed={k === t.track}
                    onClick={() => t.tune(t.index, k)}
                  >
                    <span className="tab">{String.fromCharCode(65 + k)}</span>
                    {x.name}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="console">
            <div className="transport">
              <button type="button" className="key-sq" onClick={() => step(-1)} aria-label="Previous station">
                <ChevronLeft size={20} />
              </button>
              <RingButton
                playing={t.playing}
                buffering={t.buffering}
                progress={t.progress}
                onClick={t.toggle}
                label={t.on ? undefined : "Tune in"}
              />
              <button type="button" className="key-sq" onClick={() => step(1)} aria-label="Next station">
                <ChevronRight size={20} />
              </button>
            </div>
            <Scope peek={t.peek} playing={t.playing} seed={t.index * 1.7} demo={demo} />
          </div>

          <div className="actions">
            <button type="button" className="act act-lock" aria-pressed={locked} onClick={lockIn}>
              <span className="lamp" aria-hidden="true" />
              Lock in<kbd>L</kbd>
            </button>
            <button type="button" className="act" onClick={skip}>
              Skip<kbd>S</kbd>
            </button>
            <button type="button" className="act" aria-pressed={presetAt >= 0} onClick={preset}>
              {presetAt >= 0 ? `Preset ${presetAt + 1}` : "Preset"}
              <kbd>B</kbd>
            </button>
            <button type="button" className="act act-quiet" onClick={never}>
              <Ban size={15} aria-hidden="true" />
              Never this station
            </button>
            <a className="act act-quiet" href={spotifyUrl(s.artist.name)} target="_blank" rel="noreferrer">
              <ExternalLink size={15} aria-hidden="true" />
              Spotify
            </a>
            <button type="button" className="act act-quiet" onClick={() => shareStation(s, setToast)}>
              <Share2 size={15} aria-hidden="true" />
              Share
            </button>
          </div>

          <p className="upnext">
            Up next <span className="tab">{fmt(nxt.freq)}</span> <strong>{nxt.artist.name}</strong>
            <span className="upnext-why">{upNext.why}</span>
          </p>
        </main>

        <aside className="presets" aria-label="Presets">
          <h2>Presets</h2>
          <ol>
            {presets.map((pid, k) => {
              const ps = pid ? byId(pid) : null
              return (
                <li key={k} data-active={pid === id || undefined}>
                  <button type="button" className="preset" onClick={() => recall(k)} aria-label={ps ? `Preset ${k + 1}: ${ps.artist.name}` : `Preset ${k + 1}, empty`}>
                    <span className="preset-n tab">{k + 1}</span>
                    {ps ? (
                      <span className="preset-name">
                        {ps.artist.name}
                        <small className="tab">{fmt(ps.freq)}</small>
                      </span>
                    ) : (
                      <span className="preset-empty">Empty</span>
                    )}
                  </button>
                  {ps && (
                    <button
                      type="button"
                      className="preset-clear"
                      aria-label={`Clear preset ${k + 1}`}
                      onClick={() => setPresets(presets.map((x, j) => (j === k ? null : x)))}
                    >
                      <X size={14} />
                    </button>
                  )}
                </li>
              )
            })}
          </ol>
          <p className="hint">
            <kbd>B</kbd> saves the station you&rsquo;re on. <kbd>1</kbd>–<kbd>6</kbd> tune straight to it.
          </p>
        </aside>

        <aside className="log" aria-label="Tonight's log">
          <h2>Tonight</h2>
          {log.length ? (
            <ol>
              {log.map((e, k) => {
                const ls = byId(e.id)
                return (
                  <li key={k} data-kind={e.kind}>
                    <span className="log-meta">
                      <button type="button" className="log-a" onClick={() => tuneTo(ls.i)} disabled={prefs.never.has(e.id)}>
                        {ls.artist.name}
                      </button>
                      <span className="log-v">{e.kind === "preset" ? `Preset ${(e.slot ?? 0) + 1}` : VERB[e.kind]}</span>
                    </span>
                    <span className="tab log-t">{clock(e.at)}</span>
                  </li>
                )
              })}
            </ol>
          ) : (
            <p className="log-empty">
              Nothing logged yet. Lock in what grabs you and skip what doesn&rsquo;t. The dial leans toward
              your calls.
            </p>
          )}
          <dl className="keys">
            <div><dt><kbd>Space</kbd></dt><dd>Play / pause</dd></div>
            <div><dt><kbd>←</kbd><kbd>→</kbd></dt><dd>Tune</dd></div>
            <div><dt><kbd>L</kbd> <kbd>S</kbd></dt><dd>Lock in / skip</dd></div>
          </dl>
        </aside>
      </div>

      <div className="thumbbar" aria-label="Quick controls" role="group">
        <button type="button" className="act act-lock" aria-pressed={locked} onClick={lockIn}>
          <span className="lamp" aria-hidden="true" />
          Lock in
        </button>
        <RingButton playing={t.playing} buffering={t.buffering} progress={t.progress} onClick={t.toggle} size={60} label={t.on ? undefined : "Tune in"} />
        <button type="button" className="act" onClick={skip}>
          Skip
        </button>
      </div>

      <p className="toast" role="status" aria-live="polite" data-show={toast ? true : undefined}>
        {toast}
      </p>
    </div>
  )
}

function useRefLatest<T>(v: T) {
  const ref = useRef(v)
  useEffect(() => {
    ref.current = v
  })
  return ref
}
