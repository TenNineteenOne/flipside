"use client"

import { useEffect, useRef } from "react"
import type { Radio } from "./radio"

const BARS = 56
const SEGS = 16

/**
 * Segmented spectrum display. Reads the real signal through an AnalyserNode when it can; otherwise
 * synthesises a spectrum from the playback clock (never from Math.random, so it tracks the music's time).
 */
export function Scope({
  peek,
  playing,
  seed,
  demo,
}: {
  peek: () => Radio | null
  playing: boolean
  seed: number
  demo?: boolean
}) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const levels = useRef(new Float32Array(BARS))
  const peaks = useRef(new Float32Array(BARS))

  useEffect(() => {
    const c = canvas.current
    if (!c) return
    const g = c.getContext("2d")
    if (!g) return
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches
    const bins = new Uint8Array(new ArrayBuffer(256))
    const css = getComputedStyle(c)
    const lit = css.getPropertyValue("--dial").trim() || "#f0a640"
    const hot = css.getPropertyValue("--needle").trim() || "#e0603a"
    const unlit = css.getPropertyValue("--seg-off").trim() || "#2a2622"
    let w = 0
    let h = 0
    const size = () => {
      const dpr = Math.min(2, devicePixelRatio || 1)
      w = c.clientWidth
      h = c.clientHeight
      c.width = Math.round(w * dpr)
      c.height = Math.round(h * dpr)
      g.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
    size()
    const ro = new ResizeObserver(() => {
      size()
      draw()
    })
    ro.observe(c)

    const sample = (t: number) => {
      const r = peek()
      const live = !demo && r ? r.read(bins) : false
      const lv = levels.current
      for (let k = 0; k < BARS; k++) {
        let v: number
        if (live) {
          // log-spaced bars from ~170 Hz to ~15 kHz
          const lo = Math.floor(2 * Math.pow(90, k / BARS))
          const hi = Math.max(lo + 1, Math.floor(2 * Math.pow(90, (k + 1) / BARS)))
          let m = 0
          for (let b = lo; b < hi; b++) m = Math.max(m, bins[b])
          v = (m / 255) * (0.85 + (k / BARS) * 0.5)
        } else if (playing) {
          const tilt = Math.pow(1 - k / BARS, 0.6)
          const beat = Math.exp(-((t * 2.05) % 1) * 5) * (k < 10 ? 1 - k / 10 : 0)
          const mod = (0.5 + 0.5 * Math.sin(t * 2.3 + k * 0.62 + seed)) * (0.55 + 0.45 * Math.sin(t * 5.1 + k * 1.7 + seed * 2))
          v = tilt * (0.18 + 0.5 * mod) + beat * 0.35
        } else v = 0
        lv[k] = v > lv[k] ? v : lv[k] * 0.86 + v * 0.14
        const p = peaks.current
        p[k] = Math.max(lv[k], p[k] - 0.012)
      }
    }

    const draw = () => {
      g.clearRect(0, 0, w, h)
      const gap = 2
      const bw = (w - gap * (BARS - 1)) / BARS
      const sh = (h - (SEGS - 1) * 2) / SEGS
      for (let k = 0; k < BARS; k++) {
        const n = Math.round(Math.min(1, levels.current[k]) * SEGS)
        const pk = Math.min(SEGS - 1, Math.round(Math.min(1, peaks.current[k]) * SEGS))
        const x = k * (bw + gap)
        for (let s = 0; s < SEGS; s++) {
          const y = h - (s + 1) * sh - s * 2
          g.fillStyle = s < n ? (s >= SEGS - 2 ? hot : lit) : s === pk && pk > 0 ? lit : unlit
          g.fillRect(x, y, bw, sh)
        }
      }
    }

    let raf = 0
    let last = 0
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop)
      if (reduce && now - last < 250) return // 4 fps reading instead of motion
      last = now
      const r = peek()
      sample(demo ? now / 1000 : (r?.time ?? 0))
      draw()
      // let the bars fall to rest, then stop the loop until playback resumes
      if (!playing && levels.current.every((v) => v < 0.01)) cancelAnimationFrame(raf)
    }
    raf = requestAnimationFrame(loop)
    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
    }
  }, [peek, playing, seed, demo])

  return <canvas ref={canvas} className="scope" aria-hidden="true" />
}
