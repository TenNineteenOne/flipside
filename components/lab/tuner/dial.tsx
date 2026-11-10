"use client"

import { useEffect, useRef, useState, type CSSProperties } from "react"
import { BANDS, F_MAX, F_MIN, STATIONS, fmt, freqPos, nearestStation, type Radio } from "./radio"

const MAJOR = [88, 90, 92, 94, 96, 98, 100, 102, 104, 106, 108]
const MINOR = Array.from({ length: (F_MAX - F_MIN) * 2 + 1 }, (_, i) => F_MIN + i * 0.5)

/**
 * The tuning band. Every station tick is an artist you have not heard. Drag (pointer or touch),
 * arrow keys or the scroll wheel move the needle; it snaps to the nearest station on release.
 */
export function Dial({
  index,
  on,
  onTune,
  radio,
  dead,
  marks,
  presets,
}: {
  index: number
  on: boolean
  onTune: (i: number, how: "drag" | "step") => void
  radio: () => Radio
  dead?: Set<string>
  marks?: Set<string>
  presets?: (string | null)[]
}) {
  const el = useRef<HTMLDivElement>(null)
  const [drag, setDrag] = useState<number | null>(null)
  const cur = STATIONS[index]
  const x = drag ?? freqPos(cur.freq)
  const hover = drag === null ? null : nearestStation(drag, dead).station

  const step = (dir: number) => {
    let i = index
    for (let n = 0; n < STATIONS.length; n++) {
      i = (i + dir + STATIONS.length) % STATIONS.length
      if (!dead?.has(STATIONS[i].artist.id)) break
    }
    onTune(i, "step")
  }
  const stepRef = useRef(step)
  useEffect(() => {
    stepRef.current = step
  })

  // Wheel needs a non-passive listener to stop the page scrolling while you tune.
  useEffect(() => {
    const node = el.current
    if (!node) return
    let acc = 0
    let t: ReturnType<typeof setTimeout> | undefined
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      acc += Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY
      clearTimeout(t)
      t = setTimeout(() => (acc = 0), 200)
      if (Math.abs(acc) >= 45) {
        stepRef.current(Math.sign(acc))
        acc = 0
      }
    }
    node.addEventListener("wheel", onWheel, { passive: false })
    return () => node.removeEventListener("wheel", onWheel)
  }, [])

  const posOf = (clientX: number) => {
    const r = el.current!.getBoundingClientRect()
    return Math.min(1, Math.max(0, (clientX - r.left) / r.width))
  }
  const move = (p: number) => {
    setDrag(p)
    const { offset } = nearestStation(p, dead)
    radio().scrub(Math.min(1, offset / 0.35))
  }
  const end = (commit: boolean) => {
    if (drag === null) return
    const s = nearestStation(drag, dead).station
    setDrag(null)
    radio().scrub(null)
    if (commit && s.i !== index) onTune(s.i, "drag")
    else if (commit && !on) onTune(s.i, "drag")
  }

  return (
    <div className="dial-wrap" data-on={on || undefined}>
      <div
        ref={el}
        className="dial"
        role="slider"
        tabIndex={0}
        aria-label="Tuning dial"
        aria-valuemin={0}
        aria-valuemax={STATIONS.length - 1}
        aria-valuenow={index}
        aria-valuetext={`${fmt(cur.freq)} FM, ${cur.artist.name}`}
        data-dragging={drag !== null || undefined}
        style={{ "--x": x } as CSSProperties}
        onPointerDown={(e) => {
          if (e.button !== 0) return
          e.currentTarget.setPointerCapture(e.pointerId)
          move(posOf(e.clientX))
        }}
        onPointerMove={(e) => drag !== null && move(posOf(e.clientX))}
        onPointerUp={() => end(true)}
        onPointerCancel={() => end(false)}
        onKeyDown={(e) => {
          if (e.key === "ArrowRight" || e.key === "ArrowUp") step(1)
          else if (e.key === "ArrowLeft" || e.key === "ArrowDown") step(-1)
          else if (e.key === "Home") onTune(0, "step")
          else if (e.key === "End") onTune(STATIONS.length - 1, "step")
          else return
          e.preventDefault()
          e.stopPropagation()
        }}
      >
        <div className="dial-bands" aria-hidden="true">
          {BANDS.map((b) => {
            const ss = STATIONS.filter((s) => s.band === b)
            const a = freqPos(ss[0].freq) - 0.012
            const z = freqPos(ss[ss.length - 1].freq) + 0.012
            return (
              <span key={b} className="band" style={{ left: `${a * 100}%`, width: `${(z - a) * 100}%` }}>
                {b}
              </span>
            )
          })}
        </div>

        <svg className="dial-scale" viewBox="0 0 1000 100" preserveAspectRatio="none" aria-hidden="true">
          {MINOR.map((f) => {
            const major = Number.isInteger(f) && f % 2 === 0
            const X = freqPos(f) * 1000
            return <line key={f} x1={X} x2={X} y1={major ? 62 : 72} y2={100} className={major ? "tk-major" : "tk"} />
          })}
          {STATIONS.map((s) => {
            const X = freqPos(s.freq) * 1000
            const gone = dead?.has(s.artist.id)
            return (
              <line
                key={s.artist.id}
                x1={X}
                x2={X}
                y1={6}
                y2={54}
                className={gone ? "st st-dead" : s.i === index ? "st st-cur" : "st"}
              />
            )
          })}
        </svg>

        <div className="dial-nums" aria-hidden="true">
          {MAJOR.map((f) => (
            <span key={f} style={{ left: `${freqPos(f) * 100}%` }}>
              {f}
            </span>
          ))}
        </div>

        <div className="dial-marks" aria-hidden="true">
          {STATIONS.map((s) => {
            const p = presets?.indexOf(s.artist.id) ?? -1
            const m = marks?.has(s.artist.id)
            if (p < 0 && !m) return null
            return (
              <span key={s.artist.id} className="mark" style={{ left: `${freqPos(s.freq) * 100}%` }}>
                {p >= 0 ? p + 1 : "•"}
              </span>
            )
          })}
        </div>

        <div className="needle-track" aria-hidden="true">
          <div className="needle" />
        </div>
      </div>
      <p className="dial-readout" aria-hidden="true">
        {hover ? (
          <>
            <span className="tab">{fmt(hover.freq)}</span> {hover.artist.name}
          </>
        ) : (
          " "
        )}
      </p>
    </div>
  )
}
