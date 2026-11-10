"use client"

import { useEffect, useRef } from "react"
import Link from "next/link"
import { ChevronLeft, ChevronRight } from "lucide-react"
import { Dial } from "./dial"
import { Scope } from "./scope"
import { RingButton, SignalPath } from "./parts"
import { STATIONS, fmt, stationIndex } from "./radio"
import { useTuner } from "./use-tuner"

const forward = (cur: number): number => (cur + 1) % STATIONS.length

const SPEC: [string, string][] = [
  ["Sign-up", "A username"],
  ["Email", "Never asked"],
  ["Password", "None to forget"],
  ["Listening history", "Not needed"],
  ["Artists you already know", "0"],
]

export function Landing({ initialStation, demo }: { initialStation?: string; demo?: boolean }) {
  const t = useTuner(stationIndex(initialStation ?? "yinyin"), forward, demo)
  const s = STATIONS[t.index]
  const step = (dir: number) => {
    if (t.on) t.radio().blip()
    t.tune((t.index + dir + STATIONS.length) % STATIONS.length)
  }

  const keys = useRef({ toggle: t.toggle, step })
  useEffect(() => {
    keys.current = { toggle: t.toggle, step }
  })
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return
      const el = e.target as HTMLElement
      if (e.key === " " && !el.closest("button, a, input")) keys.current.toggle()
      else if (e.key === "ArrowRight" && !el.closest("input")) keys.current.step(1)
      else if (e.key === "ArrowLeft" && !el.closest("input")) keys.current.step(-1)
      else return
      e.preventDefault()
    }
    addEventListener("keydown", onKey)
    return () => removeEventListener("keydown", onKey)
  }, [])

  return (
    <div className="tn-land" data-on={t.on || undefined}>
      <header className="plate-top">
        <span className="brand">
          Flipside <span>FM</span>
        </span>
        <Link className="plate-link" href="/sign-in">
          Sign in
        </Link>
      </header>

      <section className="hero" aria-labelledby="hero-h">
        <h1 id="hero-h" className="hero-line">
          A radio that only plays what you&rsquo;ve never heard.
        </h1>

        <Dial index={t.index} on={t.on} onTune={(i) => t.tune(i)} radio={t.radio} />

        <div className="hero-deck">
          <div className="readout" aria-live="polite">
            {t.on ? (
              <>
                <p className="freq">
                  <span className="tab freq-num">{fmt(s.freq)}</span>
                  <span className="freq-unit">FM · {s.band}</span>
                </p>
                <p className="readout-name">{s.artist.name}</p>
                <p className="track">{s.artist.topTracks[t.track]?.name}</p>
                <SignalPath s={s} />
              </>
            ) : (
              <>
                <p className="freq">
                  <span className="tab freq-num">{fmt(s.freq)}</span>
                  <span className="freq-unit">Standby</span>
                </p>
                <p className="readout-name readout-standby">{STATIONS.length} stations tonight. You&rsquo;ve heard none of them.</p>
                <p className="track">Press tune in, or grab the needle.</p>
              </>
            )}
          </div>

          <div className="power">
            {t.on ? (
              <div className="transport">
                <button type="button" className="key-sq" onClick={() => step(-1)} aria-label="Previous station">
                  <ChevronLeft size={20} />
                </button>
                <RingButton playing={t.playing} buffering={t.buffering} progress={t.progress} onClick={t.toggle} size={120} />
                <button type="button" className="key-sq" onClick={() => step(1)} aria-label="Next station">
                  <ChevronRight size={20} />
                </button>
              </div>
            ) : (
              <button type="button" className="tune-in" onClick={() => t.tune(t.index)}>
                <span className="tune-in-lamp" aria-hidden="true" />
                Tune in
              </button>
            )}
          </div>

          <div className="hero-scope">
            {t.on && (
              // eslint-disable-next-line @next/next/no-img-element -- lab brief: plain <img> from the mzstatic CDN
              <img className="art art-sm" src={s.artist.imageUrl} alt={`${s.artist.name} cover art`} width={600} height={600} key={s.artist.imageUrl} />
            )}
            <Scope peek={t.peek} playing={t.playing} seed={t.index * 1.7} demo={demo} />
          </div>
        </div>
      </section>

      <section className="pitch" aria-labelledby="pitch-h">
        <div className="pitch-copy">
          <h2 id="pitch-h">Every station is an artist you&rsquo;ve never heard.</h2>
          <p>
            Thirty seconds each, back to back, for as long as you leave it on. Lock in what grabs you and
            the dial leans that way. Skip what doesn&rsquo;t and it steers clear. Save the keepers to six
            presets, like the car radio you grew up with.
          </p>
          <Link className="cta" href="/sign-in?mode=new">
            Get your own dial
          </Link>
        </div>
        <dl className="spec">
          {SPEC.map(([k, v]) => (
            <div key={k}>
              <dt>{k}</dt>
              <dd className="tab">{v}</dd>
            </div>
          ))}
        </dl>
      </section>

      <footer className="plate-foot">
        <span>Flipside FM</span>
        <span>Music discovery, without the strings.</span>
      </footer>
    </div>
  )
}
