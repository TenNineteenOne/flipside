"use client"
/* eslint-disable @next/next/no-img-element -- lab brief: plain <img> for CDN artwork */

import { forwardRef, useEffect, useImperativeHandle, useRef, useState, type ReactNode } from "react"
import { buildTerrain, type Terrain } from "./terrain"
import { GRID, REGION, type AtlasGenres, type AtlasSetup } from "./types"

export interface PinView {
  id: string
  name: string
  imageUrl: string
  x: number
  y: number
  sx: number
  sy: number
  state: "open" | "flag" | "hidden" | "faded"
  saved: boolean
}

export interface Flag { x: number; y: number; t0: number }

export interface MapHandle {
  flyTo: (x: number, y: number, s?: number) => void
  zoomBy: (f: number) => void
  home: () => void
}

export interface GenreHit { label: string; ex: string; x: number; y: number }

interface Props {
  setup: AtlasSetup
  pins: PinView[]
  flags: Flag[]
  avoid: { x: number; y: number }[]
  frontier: number
  selectedId: string | null
  onPin: (id: string) => void
  onGenres?: (g: GenreHit[]) => void
  highlight?: GenreHit | null
  drift?: boolean
  scrollZoom?: boolean
  /** Screen space the UI covers, so framing and fly-to centre on what's visible. */
  padRight?: number
  padBottom?: number
  padTop?: number
  padLeft?: number
  className?: string
  label: string
  children?: ReactNode
}

// Inks. Must match atlas.css.
const BG: [number, number, number] = [243, 246, 248]
const BGS = "rgb(243,246,248)"
const INK = "#16202c"
const INK2 = "#3c5267"
const RED = "#c8331c"
const MIN_S = 0.035, MAX_S = 1.6

interface Leaves { n: number; x: Float32Array; y: Float32Array; label: string[]; ex: string[]; color: string[]; f: Uint8Array }

const reduced = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches
const easeOut = (t: number) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t))

export const AtlasMap = forwardRef<MapHandle, Props>(function AtlasMap(props, ref) {
  const wrap = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const pinEls = useRef(new Map<string, HTMLButtonElement>())
  const scaleBar = useRef<HTMLDivElement>(null)
  const scaleLabel = useRef<HTMLSpanElement>(null)
  const needle = useRef<SVGGElement>(null)
  const compassText = useRef<HTMLSpanElement>(null)
  const calloutEl = useRef<HTMLDivElement>(null)
  const P = useRef(props)
  P.current = props
  const [callout, setCallout] = useState<GenreHit | null>(null)
  const calloutRef = useRef<GenreHit | null>(null)
  calloutRef.current = callout ?? props.highlight ?? null
  const compassTarget = useRef<string | null>(null)

  // Everything the frame loop touches lives in one mutable bag: no React renders while panning.
  const S = useRef({
    cam: { x: 0, y: 0, s: 0.15 },
    w: 0, h: 0, dpr: 1,
    raf: 0, framed: false,
    leaves: null as Leaves | null,
    regions: [] as AtlasGenres["regions"],
    terrain: null as Terrain | null,
    font: "sans-serif",
    widths: new Map<string, number>(),
    hatch: null as CanvasPattern | null,
    off: null as HTMLCanvasElement | null,
    pending: null as null | [number, number, number],
    fly: null as null | { from: { x: number; y: number; s: number }; to: { x: number; y: number; s: number }; t0: number; dur: number; out: number },
    vel: { x: 0, y: 0 },
    drift0: 0,
    touched: false,
    pointers: new Map<number, { x: number; y: number }>(),
    down: null as null | { x: number; y: number; t: number; moved: number },
    pinch: null as null | { d: number; s: number },
  })

  const invalidate = () => {
    const st = S.current
    if (!st.raf) st.raf = requestAnimationFrame(frame)
  }

  // ── camera helpers ────────────────────────────────────────────────────────
  const view = () => {
    const st = S.current, p = P.current
    const l = p.padLeft ?? 0, r = p.padRight ?? 0, t = p.padTop ?? 0, b = p.padBottom ?? 0
    return { cx: l + (st.w - l - r) / 2, cy: t + (st.h - t - b) / 2, vw: st.w - l - r, vh: st.h - t - b }
  }
  const toScreen = (x: number, y: number) => {
    const { cam, w, h } = S.current
    return [(x - cam.x) * cam.s + w / 2, (y - cam.y) * cam.s + h / 2]
  }
  const toWorld = (sx: number, sy: number) => {
    const { cam, w, h } = S.current
    return [(sx - w / 2) / cam.s + cam.x, (sy - h / 2) / cam.s + cam.y]
  }
  const clampS = (s: number) => Math.max(MIN_S, Math.min(MAX_S, s))
  /** Camera that puts world (x, y) at the centre of the visible (unpadded) area. */
  const camFor = (x: number, y: number, s: number) => {
    const { w, h } = S.current, v = view()
    return { x: x - (v.cx - w / 2) / s, y: y - (v.cy - h / 2) / s, s }
  }
  const zoomAt = (sx: number, sy: number, f: number) => {
    const st = S.current
    const [wx, wy] = toWorld(sx, sy)
    st.cam.s = clampS(st.cam.s * f)
    st.cam.x = wx - (sx - st.w / 2) / st.cam.s
    st.cam.y = wy - (sy - st.h / 2) / st.cam.s
    st.fly = null
    invalidate()
  }
  const fitTo = (pts: { x: number; y: number }[], margin = 1.15) => {
    const v = view()
    const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y)
    const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys)
    const s = clampS(Math.min(v.vw / ((x1 - x0) * margin + 1), v.vh / ((y1 - y0) * margin + 1)))
    return camFor((x0 + x1) / 2, (y0 + y1) / 2, s)
  }
  const homeCam = () => {
    const p = P.current
    const near = p.pins.filter((q) => q.state !== "hidden").sort((a, b) => dist(a, p.setup.centre) - dist(b, p.setup.centre)).slice(0, 9)
    return fitTo([...p.setup.home, ...near], 1.3)
  }
  const flyTo = (x: number, y: number, s?: number) => {
    const st = S.current
    // Not laid out yet: remember the target and jump there on first size.
    if (!st.w) { st.pending = [x, y, s ?? 0.3]; st.touched = true; return }
    const to = camFor(x, y, clampS(s ?? Math.max(st.cam.s, 0.3)))
    st.touched = true
    if (reduced()) { st.cam = to; st.fly = null; invalidate(); return }
    const d = Math.hypot(to.x - st.cam.x, to.y - st.cam.y)
    const out = Math.max(MIN_S, Math.min(st.cam.s, to.s, (st.w * 0.7) / (d || 1)))
    st.fly = { from: { ...st.cam }, to, t0: performance.now(), dur: Math.min(1400, 600 + d * 0.06), out }
    invalidate()
  }
  useImperativeHandle(ref, () => ({
    flyTo,
    zoomBy: (f) => { const v = view(); zoomAt(v.cx, v.cy, f) },
    home: () => { const c = homeCam(); flyTo(c.x + (view().cx - S.current.w / 2) / c.s, c.y + (view().cy - S.current.h / 2) / c.s, c.s) },
  }))

  // ── draw ──────────────────────────────────────────────────────────────────
  function frame(now: number) {
    const st = S.current, p = P.current
    st.raf = 0
    const c = canvas.current
    if (!c || !st.w) return
    const ctx = c.getContext("2d")!
    let again = false

    if (st.fly) {
      const f = st.fly, t = Math.min(1, (now - f.t0) / f.dur), e = easeOut(t)
      const l0 = Math.log(f.from.s), l1 = Math.log(f.to.s), lo = Math.log(f.out)
      const bump = Math.min(0, lo - Math.min(l0, l1))
      st.cam = { x: f.from.x + (f.to.x - f.from.x) * e, y: f.from.y + (f.to.y - f.from.y) * e, s: Math.exp(l0 + (l1 - l0) * e + bump * Math.sin(Math.PI * e)) }
      if (t < 1) again = true
      else st.fly = null
    } else if (Math.abs(st.vel.x) + Math.abs(st.vel.y) > 0.05 && !st.pointers.size) {
      st.cam.x -= st.vel.x / st.cam.s
      st.cam.y -= st.vel.y / st.cam.s
      st.vel.x *= 0.92; st.vel.y *= 0.92
      again = true
    } else if (p.drift && !st.touched && !reduced()) {
      // Landing: the map breathes, slowly sliding east toward the acoustic side and back.
      if (!st.drift0) st.drift0 = now
      const t = (now - st.drift0) / 1000
      st.cam.x += Math.sin(t / 9) * 0.14 / st.cam.s
      st.cam.y += Math.sin(t / 13) * 0.04 / st.cam.s
      again = true
    }
    // Keep the sheet on the table: the view centre can't leave the map.
    st.cam.x = Math.max(0, Math.min(p.setup.w, st.cam.x))
    st.cam.y = Math.max(0, Math.min(p.setup.h, st.cam.y))
    const { cam, w, h, dpr } = st
    const s = cam.s
    const ox = w / 2 - cam.x * s, oy = h / 2 - cam.y * s
    const SX = (x: number) => x * s + ox, SY = (y: number) => y * s + oy

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.fillStyle = BGS
    ctx.fillRect(0, 0, w, h)

    // Terrain: banded tints + contours, both in world space.
    if (st.terrain) {
      ctx.setTransform(dpr * s, 0, 0, dpr * s, dpr * ox, dpr * oy)
      ctx.imageSmoothingEnabled = true
      ctx.drawImage(st.terrain.tint, 0, 0, st.terrain.w, st.terrain.h)
      st.terrain.contours.forEach((path, i) => {
        ctx.strokeStyle = i >= 3 ? "rgba(22,32,44,0.30)" : "rgba(22,32,44,0.16)"
        ctx.lineWidth = (i >= 3 ? 1 : 0.75) / s
        ctx.stroke(path)
      })
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }

    // Graticule.
    ctx.strokeStyle = "rgba(60,82,103,0.10)"
    ctx.lineWidth = 1
    ctx.beginPath()
    for (let gx = Math.floor((-ox / s) / GRID) * GRID; SX(gx) < w; gx += GRID) { const x = Math.round(SX(gx)) + 0.5; ctx.moveTo(x, 0); ctx.lineTo(x, h) }
    for (let gy = Math.floor((-oy / s) / GRID) * GRID; SY(gy) < h; gy += GRID) { const y = Math.round(SY(gy)) + 0.5; ctx.moveTo(0, y); ctx.lineTo(w, y) }
    ctx.stroke()

    const cx = SX(p.setup.centre.x), cy = SY(p.setup.centre.y)

    // Frontier ring.
    const fr = p.frontier * REGION * s
    ctx.setLineDash([2, 6])
    ctx.lineCap = "round"
    ctx.strokeStyle = INK2
    ctx.lineWidth = 1.5
    ctx.beginPath(); ctx.arc(cx, cy, fr, 0, Math.PI * 2); ctx.stroke()
    ctx.setLineDash([])
    const frontierLabel: [number, number] = [cx, cy - fr]

    // Fog over directions you've ruled out.
    for (const a of p.avoid) {
      const ax = SX(a.x), ay = SY(a.y), r = 1300 * s
      ctx.fillStyle = "rgba(243,246,248,0.78)"
      ctx.beginPath(); ctx.arc(ax, ay, r, 0, Math.PI * 2); ctx.fill()
      ctx.setLineDash([5, 5]); ctx.strokeStyle = "rgba(60,82,103,0.45)"; ctx.lineWidth = 1; ctx.stroke(); ctx.setLineDash([])
    }

    // Your territory: union of circles around the genres you already live in, plus planted flags.
    const circles: number[] = []
    const cr = 250 * s
    for (let i = 0; i < p.setup.coast.length; i += 2) circles.push(SX(p.setup.coast[i]), SY(p.setup.coast[i + 1]), cr)
    for (const fl of p.flags) {
      const g = Math.min(1, (now - fl.t0) / 1100)
      if (g < 1) again = true
      const e = easeOut(g)
      circles.push(SX(fl.x), SY(fl.y), 480 * s * e)
      const L = st.leaves
      if (L) for (let i = 0; i < L.n; i++) if (Math.abs(L.x[i] - fl.x) < 520 && Math.abs(L.y[i] - fl.y) < 520 && Math.hypot(L.x[i] - fl.x, L.y[i] - fl.y) < 520) circles.push(SX(L.x[i]), SY(L.y[i]), cr * e)
    }
    // Drawn offscreen so overlapping circles merge into one clean coastline over the terrain.
    const off = st.off ?? (st.off = document.createElement("canvas"))
    if (off.width !== c.width || off.height !== c.height) { off.width = c.width; off.height = c.height }
    const o = off.getContext("2d")!
    o.setTransform(dpr, 0, 0, dpr, 0, 0)
    o.clearRect(0, 0, w, h)
    const terr = new Path2D()
    for (let i = 0; i < circles.length; i += 3) {
      if (circles[i + 2] <= 0) continue
      terr.moveTo(circles[i] + circles[i + 2], circles[i + 1])
      terr.arc(circles[i], circles[i + 1], circles[i + 2], 0, Math.PI * 2)
    }
    o.strokeStyle = RED; o.lineWidth = 5; o.lineJoin = "round"
    o.stroke(terr)
    o.globalCompositeOperation = "destination-out"
    o.fillStyle = "#000"
    o.fill(terr)
    o.globalCompositeOperation = "source-over"
    o.fillStyle = "rgba(200,51,28,0.075)"
    o.fill(terr)
    if (st.hatch) {
      st.hatch.setTransform(new DOMMatrix().translate(ox % 7, oy % 7))
      o.fillStyle = st.hatch
      o.fill(terr)
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.drawImage(off, 0, 0)
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

    // Routes from the landmark you know to each pin.
    const pinScreen = new Map<string, [number, number]>()
    for (const pin of p.pins) pinScreen.set(pin.id, [SX(pin.x), SY(pin.y)])
    for (const pin of p.pins) {
      if (pin.state === "hidden") continue
      const [px, py] = pinScreen.get(pin.id)!
      const [sx, sy] = [SX(pin.sx), SY(pin.sy)]
      const mx = (sx + px) / 2 + (py - sy) * 0.18, my = (sy + py) / 2 - (px - sx) * 0.18
      ctx.strokeStyle = pin.state === "flag" ? RED : pin.id === p.selectedId ? INK : "rgba(22,32,44,0.45)"
      ctx.lineWidth = pin.state === "flag" || pin.id === p.selectedId ? 2 : 1.25
      ctx.setLineDash(pin.state === "flag" ? [] : [6, 5])
      ctx.globalAlpha = pin.state === "faded" ? 0.25 : 1
      ctx.beginPath(); ctx.moveTo(sx, sy); ctx.quadraticCurveTo(mx, my, px, py); ctx.stroke()
    }
    ctx.setLineDash([]); ctx.globalAlpha = 1

    // Genre dots.
    const L = st.leaves
    const M = 40
    if (L) {
      const big = s > 0.3, r = big ? Math.min(5, 1.6 + s * 2.4) : 1.6
      for (let i = 0; i < L.n; i++) {
        const x = L.x[i] * s + ox, y = L.y[i] * s + oy
        if (x < -M || y < -M || x > w + M || y > h + M) continue
        ctx.fillStyle = L.color[i]
        if (big) { ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill() }
        else ctx.fillRect(x - 1.25, y - 1.25, 2.5, 2.5)
      }
    }

    // ── labels, collision-culled through a grid bucket ─────────────────────
    const occ = new Map<number, number[]>()
    const B = 48
    const fits = (x0: number, y0: number, x1: number, y1: number) => {
      for (let gx = Math.floor(x0 / B); gx <= Math.floor(x1 / B); gx++)
        for (let gy = Math.floor(y0 / B); gy <= Math.floor(y1 / B); gy++) {
          const b = occ.get(gx * 8192 + gy)
          if (b) for (let k = 0; k < b.length; k += 4) if (x0 < b[k + 2] && x1 > b[k] && y0 < b[k + 3] && y1 > b[k + 1]) return false
        }
      return true
    }
    const take = (x0: number, y0: number, x1: number, y1: number) => {
      for (let gx = Math.floor(x0 / B); gx <= Math.floor(x1 / B); gx++)
        for (let gy = Math.floor(y0 / B); gy <= Math.floor(y1 / B); gy++) {
          const k = gx * 8192 + gy
          const b = occ.get(k)
          if (b) b.push(x0, y0, x1, y1); else occ.set(k, [x0, y0, x1, y1])
        }
    }
    const font = (weight: number, size: number, italic = false) => `${italic ? "italic " : ""}${weight} ${size}px ${st.font}`
    const width = (text: string, f: string, spacing = "0px") => {
      const k = f + spacing + text
      let v = st.widths.get(k)
      if (v === undefined) { ctx.font = f; ctx.letterSpacing = spacing; v = ctx.measureText(text).width; st.widths.set(k, v) }
      return v
    }
    /** Place a label centred on (x, y) if it doesn't collide. */
    const place = (text: string, x: number, y: number, f: string, size: number, fill: string, halo = 3, spacing = "0px") => {
      const tw = width(text, f, spacing)
      ctx.font = f
      ctx.letterSpacing = spacing
      const x0 = x - tw / 2 - 2, y0 = y - size * 0.7, x1 = x + tw / 2 + 2, y1 = y + size * 0.55
      if (x1 < 0 || x0 > w || y1 < 0 || y0 > h || !fits(x0, y0, x1, y1)) return false
      take(x0, y0, x1, y1)
      ctx.textAlign = "center"; ctx.textBaseline = "middle"
      if (halo) { ctx.lineWidth = halo; ctx.strokeStyle = "rgba(243,246,248,0.92)"; ctx.lineJoin = "round"; ctx.strokeText(text, x, y) }
      ctx.fillStyle = fill
      ctx.fillText(text, x, y)
      return true
    }
    // Nothing gets lettered under the floating UI or the genre callout.
    if (p.padTop) take(0, 0, w, p.padTop)
    if (p.padRight) take(w - p.padRight, 0, w, h)
    const hl0 = calloutRef.current
    if (hl0) { const x = SX(hl0.x), y = SY(hl0.y); take(x - 14, y - 16, x + 16 + width(hl0.label, font(700, 13)) + 30, y + 30) }
    // Reserve the pins (DOM) so labels steer around them; pin names get dropped before they overlap.
    const named = new Set<string>()
    const live = p.pins.filter((q) => q.state !== "hidden")
    for (const pin of live) {
      const [px, py] = pinScreen.get(pin.id)!
      take(px - 24, py - 64, px + 24, py + 6)
    }
    if (s > 0.09) {
      const order = [...live].sort((a, b) => Number(b.id === p.selectedId) - Number(a.id === p.selectedId) || Number(b.state === "flag") - Number(a.state === "flag"))
      for (const pin of order) {
        const [px, py] = pinScreen.get(pin.id)!
        const r = [px + 26, py - 52, px + 32 + width(pin.name, font(700, 13)), py - 32] as const
        if (pin.id === p.selectedId || fits(...r)) { take(...r); named.add(pin.id) }
      }
    }
    ctx.letterSpacing = "0px"
    // You are here.
    ctx.fillStyle = RED
    ctx.beginPath(); ctx.arc(cx, cy, 7, 0, Math.PI * 2); ctx.fill()
    ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.arc(cx, cy, 2.6, 0, Math.PI * 2); ctx.fill()
    take(cx - 9, cy - 9, cx + 9, cy + 9)
    place("You are here", cx, cy + 22, font(800, 14), 14, RED, 4)
    place("Frontier", frontierLabel[0], frontierLabel[1], font(700, 12.5, true), 12.5, INK2, 5)
    if (s < 0.24) place("YOUR TERRITORY", cx, cy - 26, font(700, 12, true), 12, RED, 4, "2.5px")

    // Landmarks: the artists you already know.
    if (s > 0.075) {
      for (const lm of p.setup.sources) {
        const x = SX(lm.x), y = SY(lm.y)
        if (x < -20 || y < -20 || x > w + 20 || y > h + 20) continue
        const fz = 12
        if (place(lm.label, x, y - 13, font(700, fz), fz, INK, 3.5)) {
          ctx.fillStyle = "#fff"; ctx.strokeStyle = INK; ctx.lineWidth = 1.5
          ctx.fillRect(x - 3.5, y - 3.5, 7, 7); ctx.strokeRect(x - 3.5, y - 3.5, 7, 7)
        }
      }
    }
    // Anchors when far out, clusters in the middle distance.
    if (s < 0.14) {
      const size = 17
      for (const r of st.regions) if (r.kind === 0) place(r.label.toUpperCase(), SX(r.x), SY(r.y), font(800, size), size, "rgba(22,32,44,0.62)", 4, "4px")
    }
    if (s > 0.06 && s < 0.42) {
      for (const r of st.regions) if (r.kind === 1) place(r.label, SX(r.x), SY(r.y), font(600, 13.5, true), 13.5, INK2, 3.5)
    }
    // Leaf genres: reveal by the data's own prominence as you zoom in.
    if (L && s > 0.1) {
      const fmin = Math.max(0, 45 - (s - 0.1) * 260)
      let shown = 0
      for (let i = 0; i < L.n && shown < 420; i++) {
        if (L.f[i] < fmin) break
        const x = L.x[i] * s + ox, y = L.y[i] * s + oy
        if (x < -80 || y < -20 || x > w + 80 || y > h + 20) continue
        const size = 11 + Math.round(L.f[i] / 20)
        if (place(L.label[i], x, y - size * 0.95, font(L.f[i] > 40 ? 600 : 500, size), size, INK)) shown++
      }
    }
    ctx.letterSpacing = "0px"

    // Highlight ring for search / tapped genre.
    const hl = calloutRef.current
    if (hl) {
      const x = SX(hl.x), y = SY(hl.y)
      ctx.strokeStyle = RED; ctx.lineWidth = 2
      ctx.beginPath(); ctx.arc(x, y, 11, 0, Math.PI * 2); ctx.stroke()
      if (calloutEl.current) calloutEl.current.style.transform = `translate3d(${x}px, ${y}px, 0)`
    }

    // Neatline: grid letters along the top, numbers down the left, like a printed sheet.
    ctx.fillStyle = "rgba(243,246,248,0.94)"
    ctx.fillRect(0, 0, w, 18); ctx.fillRect(0, 0, 18, h)
    ctx.strokeStyle = INK; ctx.lineWidth = 1
    ctx.beginPath(); ctx.moveTo(0, 18.5); ctx.lineTo(w, 18.5); ctx.moveTo(18.5, 0); ctx.lineTo(18.5, h); ctx.stroke()
    ctx.font = font(700, 10); ctx.fillStyle = INK2; ctx.textAlign = "center"; ctx.textBaseline = "middle"
    for (let gx = Math.floor((-ox / s) / GRID) * GRID; SX(gx) < w; gx += GRID) {
      const x = SX(gx + GRID / 2), col = gx / GRID
      if (x > 26 && col >= 0 && gx < p.setup.w && GRID * s > 18) ctx.fillText(String.fromCharCode(65 + col), x, 10)
    }
    for (let gy = Math.floor((-oy / s) / GRID) * GRID; SY(gy) < h; gy += GRID) {
      const y = SY(gy + GRID / 2), row = gy / GRID
      if (y > 26 && row >= 0 && gy < p.setup.h && GRID * s > 14) ctx.fillText(String(row + 1), 9.5, y)
    }

    // DOM pins follow the camera.
    for (const pin of p.pins) {
      const el = pinEls.current.get(pin.id)
      if (!el) continue
      const [px, py] = pinScreen.get(pin.id)!
      const off = px < -80 || py < -80 || px > w + 200 || py > h + 120
      el.style.transform = `translate3d(${Math.round(px)}px, ${Math.round(py)}px, 0)`
      el.style.visibility = off ? "hidden" : ""
      el.dataset.named = named.has(pin.id) ? "1" : ""
    }

    // Scale bar.
    if (scaleBar.current && scaleLabel.current) {
      const want = 110 / (s * REGION)
      const nice = [0.25, 0.5, 1, 2, 3, 5, 10].find((n) => n >= want * 0.6) ?? 10
      scaleBar.current.style.width = `${nice * REGION * s}px`
      const txt = `${nice} region${nice === 1 ? "" : "s"}`
      if (scaleLabel.current.textContent !== txt) scaleLabel.current.textContent = txt
    }
    // Compass: points toward the nearest open pin that's off-screen ("further out").
    if (needle.current && compassText.current) {
      const v = view()
      const [vx, vy] = toWorld(v.cx, v.cy)
      let best: PinView | null = null, bd = Infinity
      for (const pin of p.pins) {
        if (pin.state !== "open") continue
        const [px, py] = pinScreen.get(pin.id)!
        if (px > (p.padLeft ?? 0) && px < w - (p.padRight ?? 0) && py > (p.padTop ?? 0) && py < h - (p.padBottom ?? 0)) continue
        const d = Math.hypot(pin.x - vx, pin.y - vy)
        if (d < bd) { bd = d; best = pin }
      }
      const ang = best ? Math.atan2(best.y - vy, best.x - vx) : Math.atan2(vy - p.setup.centre.y, vx - p.setup.centre.x)
      needle.current.setAttribute("transform", `rotate(${(ang * 180) / Math.PI + 90} 32 32)`)
      const txt = best ? `${best.name} · ${(bd / REGION).toFixed(1)} regions` : "Every pin in view"
      if (compassText.current.textContent !== txt) compassText.current.textContent = txt
      compassTarget.current = best?.id ?? null
    }

    if (again) invalidate()
  }

  // ── lifecycle ─────────────────────────────────────────────────────────────
  useEffect(() => {
    const el = wrap.current!, st = S.current
    st.font = getComputedStyle(el).fontFamily || "sans-serif"
    const hc = document.createElement("canvas")
    hc.width = hc.height = 7
    const h = hc.getContext("2d")!
    h.strokeStyle = "rgba(200,51,28,0.26)"; h.lineWidth = 1.1
    h.beginPath(); h.moveTo(-1, 8); h.lineTo(8, -1); h.stroke()
    st.hatch = h.createPattern(hc, "repeat")

    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect()
      st.w = r.width; st.h = r.height; st.dpr = Math.min(2.5, window.devicePixelRatio || 1)
      const c = canvas.current!
      c.width = Math.round(st.w * st.dpr); c.height = Math.round(st.h * st.dpr)
      if (st.w && (!st.framed || (!st.touched && !st.fly))) {
        st.cam = st.pending ? camFor(st.pending[0], st.pending[1], clampS(st.pending[2])) : homeCam()
        st.framed = true
        st.pending = null
      }
      // Resizing clears the canvas, so repaint now rather than leave a blank frame until the next rAF.
      cancelAnimationFrame(st.raf); st.raf = 0
      frame(performance.now())
    })
    ro.observe(el)
    document.fonts?.ready.then(() => { st.widths.clear(); invalidate() })

    let alive = true
    fetch("/lab/atlas/genres").then((r) => r.json()).then((g: AtlasGenres) => {
      if (!alive) return
      const n = g.f.length
      const L: Leaves = { n, x: new Float32Array(n), y: new Float32Array(n), label: g.labels.split("|"), ex: g.ex.split("|"), color: [], f: Uint8Array.from(g.f) }
      for (let i = 0; i < n; i++) { L.x[i] = g.xy[i * 2]; L.y[i] = g.xy[i * 2 + 1]; L.color.push("#" + g.c.substr(i * 6, 6)) }
      st.leaves = L
      st.regions = g.regions
      st.terrain = buildTerrain(g.w, g.h, g.xy, g.c, BG)
      P.current.onGenres?.(L.label.map((label, i) => ({ label, ex: L.ex[i], x: L.x[i], y: L.y[i] })))
      invalidate()
    }).catch(() => {})
    return () => { alive = false; ro.disconnect(); cancelAnimationFrame(st.raf); st.raf = 0 }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(invalidate)
  // Layout padding settles after mount (e.g. phone vs desktop): re-frame until the visitor takes over.
  useEffect(() => {
    const st = S.current
    if (st.framed && !st.touched && !st.fly) { st.cam = homeCam(); invalidate() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.padLeft, props.padTop])

  // ── input ─────────────────────────────────────────────────────────────────
  useEffect(() => {
    const el = wrap.current!
    const onWheel = (e: WheelEvent) => {
      if (!P.current.scrollZoom && !e.ctrlKey) return
      e.preventDefault()
      S.current.touched = true
      const r = el.getBoundingClientRect()
      if (!e.ctrlKey && Math.abs(e.deltaX) > 0.5) {
        const st = S.current
        st.cam.x += e.deltaX / st.cam.s; st.cam.y += e.deltaY / st.cam.s; st.fly = null
        return invalidate()
      }
      zoomAt(e.clientX - r.left, e.clientY - r.top, Math.exp(-e.deltaY * (e.ctrlKey ? 0.012 : 0.0018)))
    }
    el.addEventListener("wheel", onWheel, { passive: false })
    return () => el.removeEventListener("wheel", onWheel)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const local = (e: React.PointerEvent) => {
    const r = wrap.current!.getBoundingClientRect()
    return { x: e.clientX - r.left, y: e.clientY - r.top }
  }
  const onPointerDown = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest("button, a, input")) return
    const st = S.current, pt = local(e)
    st.pointers.set(e.pointerId, pt)
    ;(e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId)
    st.touched = true; st.fly = null; st.vel = { x: 0, y: 0 }
    if (st.pointers.size === 1) st.down = { ...pt, t: performance.now(), moved: 0 }
    if (st.pointers.size === 2) {
      const [a, b] = [...st.pointers.values()]
      st.pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), s: st.cam.s }
    }
  }
  const onPointerMove = (e: React.PointerEvent) => {
    const st = S.current
    const prev = st.pointers.get(e.pointerId)
    if (!prev) return
    const pt = local(e)
    st.pointers.set(e.pointerId, pt)
    if (st.pointers.size === 2 && st.pinch) {
      const [a, b] = [...st.pointers.values()]
      const d = Math.hypot(a.x - b.x, a.y - b.y)
      zoomAt((a.x + b.x) / 2, (a.y + b.y) / 2, (st.pinch.s * (d / st.pinch.d)) / st.cam.s)
      if (st.down) st.down.moved = 99
      return
    }
    const dx = pt.x - prev.x, dy = pt.y - prev.y
    st.cam.x -= dx / st.cam.s; st.cam.y -= dy / st.cam.s
    st.vel = { x: dx, y: dy }
    if (st.down) st.down.moved += Math.abs(dx) + Math.abs(dy)
    invalidate()
  }
  const onPointerUp = (e: React.PointerEvent) => {
    const st = S.current
    st.pointers.delete(e.pointerId)
    if (st.pointers.size < 2) st.pinch = null
    if (reduced()) st.vel = { x: 0, y: 0 }
    if (st.down && !st.pointers.size) {
      if (st.down.moved < 6 && performance.now() - st.down.t < 500) tapGenre(local(e))
      st.down = null
    }
    invalidate()
  }
  const tapGenre = ({ x, y }: { x: number; y: number }) => {
    const st = S.current, L = st.leaves
    st.vel = { x: 0, y: 0 }
    if (!L) return
    let best = -1, bd = 16
    for (let i = 0; i < L.n; i++) {
      const [sx, sy] = toScreen(L.x[i], L.y[i])
      const d = Math.hypot(sx - x, sy - y)
      if (d < bd) { bd = d; best = i }
    }
    setCallout(best < 0 ? null : { label: L.label[best], ex: L.ex[best], x: L.x[best], y: L.y[best] })
  }
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.target !== e.currentTarget) return
    const st = S.current, step = 90 / st.cam.s
    const k = e.key
    if (k === "ArrowLeft") st.cam.x -= step
    else if (k === "ArrowRight") st.cam.x += step
    else if (k === "ArrowUp") st.cam.y -= step
    else if (k === "ArrowDown") st.cam.y += step
    else if (k === "+" || k === "=") { const v = view(); return zoomAt(v.cx, v.cy, 1.4) }
    else if (k === "-" || k === "_") { const v = view(); return zoomAt(v.cx, v.cy, 1 / 1.4) }
    else return
    e.preventDefault(); st.touched = true; st.fly = null
    invalidate()
  }

  const shown = callout ?? props.highlight ?? null

  return (
    <div
      ref={wrap}
      className={`atlas-map ${props.className ?? ""}`}
      tabIndex={0}
      role="application"
      aria-label={props.label}
      aria-roledescription="map"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={(e) => { const p = local(e as unknown as React.PointerEvent); zoomAt(p.x, p.y, 2) }}
      onKeyDown={onKeyDown}
    >
      <canvas ref={canvas} aria-hidden="true" />
      <div className="atlas-pins" aria-hidden="true">
        {props.pins.map((pin) => (
          <button
            key={pin.id}
            ref={(el) => { if (el) pinEls.current.set(pin.id, el); else pinEls.current.delete(pin.id) }}
            className="atlas-pin"
            data-state={pin.state}
            data-selected={pin.id === props.selectedId || undefined}
            data-saved={pin.saved || undefined}
            tabIndex={-1}
            disabled={pin.state === "hidden"}
            onClick={() => props.onPin(pin.id)}
            style={{ visibility: "hidden" }}
          >
            {pin.state === "hidden" ? (
              <span className="atlas-pin-unknown">?</span>
            ) : (
              <>
                <span className="atlas-pin-head">
                  <img src={pin.imageUrl} alt="" width={40} height={40} loading="lazy" draggable={false} />
                </span>
                <span className="atlas-pin-stem" />
                <span className="atlas-pin-name">{pin.name}</span>
                {pin.state === "flag" && (
                  <svg className="atlas-pin-flag" viewBox="0 0 16 20" width="16" height="20"><path d="M2 20V1h1v1h11l-3 4 3 4H3v10z" /></svg>
                )}
              </>
            )}
          </button>
        ))}
      </div>
      {shown && (
        <div ref={calloutEl} className="atlas-callout" role="status">
          <div>
            <b>{shown.label}</b>
            {shown.ex && <span>e.g. {shown.ex}</span>}
          </div>
        </div>
      )}
      <div className="atlas-furniture" aria-hidden="false">
        <div className="atlas-scale" aria-label="Map scale">
          <div ref={scaleBar} className="atlas-scale-bar"><i /><i /></div>
          <span ref={scaleLabel}>1 region</span>
        </div>
        <button
          type="button"
          className="atlas-compass"
          onClick={() => {
            const id = compassTarget.current
            if (id) props.onPin(id)
            else { const c = props.setup.centre; flyTo(c.x, c.y, 0.12) }
          }}
          aria-label="Compass: go to the nearest pin further out"
        >
          <svg viewBox="0 0 64 64" width="56" height="56" aria-hidden="true">
            <circle cx="32" cy="32" r="30" className="rose" />
            <path d="M32 3v6M32 55v6M3 32h6M55 32h6" className="ticks" />
            <text x="32" y="17" textAnchor="middle">N</text>
            <g ref={needle}>
              <path d="M32 12l5 20h-10z" className="north" />
              <path d="M32 52l5-20h-10z" className="south" />
            </g>
            <circle cx="32" cy="32" r="2.5" fill="#fff" stroke="currentColor" />
          </svg>
          <span className="atlas-compass-text">
            <small>Further out</small>
            <span ref={compassText}>…</span>
          </span>
        </button>
        {props.children}
      </div>
    </div>
  )
})

const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y)
