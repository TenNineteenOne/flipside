"use client"

import { labArtists, type LabArtist } from "@/lib/lab/artists"

/* ---------- Stations: every unknown artist gets a frequency, grouped by genre band ---------- */

export type Band = "Groove" | "Psych" | "Roots" | "Jazz"
export const BANDS: Band[] = ["Groove", "Psych", "Roots", "Jazz"]
export const F_MIN = 87.5
export const F_MAX = 108
export const PREVIEW_S = 30

export interface Station {
  i: number
  artist: LabArtist
  band: Band
  freq: number
}

function bandOf(genres: string[]): Band {
  const g = genres.join(" ")
  if (/jazz/.test(g)) return "Jazz"
  if (/folk|blues|sufi|mpb|tropic|western/.test(g)) return "Roots"
  if (/psych|rock|kraut/.test(g)) return "Psych"
  return "Groove"
}

export const STATIONS: Station[] = (() => {
  const out: Station[] = []
  let f = 88.9
  BANDS.forEach((band, b) => {
    if (b > 0) f += 1.6 // dead air between bands
    for (const artist of labArtists.filter((a) => bandOf(a.genres) === band)) {
      out.push({ i: out.length, artist, band, freq: Math.round(f * 10) / 10 })
      f += 0.8
    }
  })
  return out
})()

export const freqPos = (f: number) => (f - F_MIN) / (F_MAX - F_MIN)
export const fmt = (f: number) => f.toFixed(1)
export const stationIndex = (id: string | undefined | null) => {
  const i = STATIONS.findIndex((s) => s.artist.id === id)
  return i < 0 ? 0 : i
}
export function nearestStation(pos: number, skip?: Set<string>) {
  const f = F_MIN + pos * (F_MAX - F_MIN)
  let best = STATIONS[0]
  for (const s of STATIONS) {
    if (skip?.has(s.artist.id)) continue
    if (Math.abs(s.freq - f) < Math.abs(best.freq - f) || skip?.has(best.artist.id)) best = s
  }
  return { station: best, offset: Math.abs(best.freq - f) }
}

/* ---------- Radio: one <audio> element we own, optionally routed through Web Audio ---------- */

type Listener = () => void

export class Radio {
  audio: HTMLAudioElement | null = null
  private ctx: AudioContext | null = null
  private gain: GainNode | null = null
  private analyser: AnalyserNode | null = null
  private hissGain: GainNode | null = null
  private routed = false
  private seq = 0
  private fadeTimer: ReturnType<typeof setInterval> | undefined
  private silentSince = 0
  playing = false
  buffering = false
  progress = 0
  live = false // analyser is reading real audio
  onEnded: Listener = () => {}
  onChange: Listener = () => {}

  /** Must run inside a user gesture the first time (autoplay policy). */
  private ensure() {
    if (this.audio) {
      void this.ctx?.resume()
      return
    }
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    try {
      this.ctx = AC ? new AC() : null
    } catch {
      this.ctx = null
    }
    this.build(!!this.ctx)
  }

  private build(route: boolean) {
    const old = this.audio
    if (old) {
      old.pause()
      old.removeAttribute("src")
      old.load()
    }
    const a = new Audio()
    a.preload = "auto"
    // Apple's preview CDN answers with access-control-allow-origin: * (checked with curl), so the
    // analyser can read real samples. If that ever stops, error/silence detection drops to build(false).
    if (route) a.crossOrigin = "anonymous"
    a.addEventListener("ended", () => this.onEnded())
    a.addEventListener("timeupdate", () => {
      const d = Math.min(a.duration || PREVIEW_S, PREVIEW_S)
      this.progress = Math.min(1, a.currentTime / d)
      this.onChange()
    })
    a.addEventListener("playing", () => this.set({ playing: true, buffering: false }))
    a.addEventListener("pause", () => this.set({ playing: false, buffering: false }))
    a.addEventListener("waiting", () => this.set({ buffering: true }))
    a.addEventListener("error", () => {
      if (this.audio !== a || !a.getAttribute("src")) return
      if (this.routed) this.fallback()
      else this.onEnded() // dead preview: move on rather than sit in silence
    })
    this.audio = a
    this.routed = false
    this.gain = this.analyser = null
    if (route && this.ctx) {
      try {
        const src = this.ctx.createMediaElementSource(a)
        this.gain = this.ctx.createGain()
        this.analyser = this.ctx.createAnalyser()
        this.analyser.fftSize = 512
        this.analyser.smoothingTimeConstant = 0.78
        src.connect(this.gain).connect(this.analyser).connect(this.ctx.destination)
        this.routed = true
      } catch {
        a.removeAttribute("crossorigin")
      }
    }
  }

  /** CORS failed or the routed element went silent: rebuild unrouted, keep the music going. */
  private fallback() {
    const a = this.audio
    if (!a) return
    const src = a.src
    const t = a.currentTime
    const wasPlaying = !a.paused
    this.build(false)
    const b = this.audio!
    b.src = src
    b.currentTime = t
    if (wasPlaying) void b.play().catch(() => {})
  }

  private set(p: Partial<Pick<Radio, "playing" | "buffering">>) {
    Object.assign(this, p)
    this.onChange()
  }

  private fade(to: number, ms: number) {
    clearInterval(this.fadeTimer)
    if (this.gain && this.ctx) {
      const g = this.gain.gain
      const now = this.ctx.currentTime
      g.cancelScheduledValues(now)
      g.setValueAtTime(g.value, now)
      g.linearRampToValueAtTime(to, now + ms / 1000)
    } else if (this.audio) {
      // shortcut: element.volume is read-only on iOS, so the dip is skipped there; audio still switches.
      const a = this.audio
      const from = a.volume
      const t0 = performance.now()
      if (ms <= 0) a.volume = to
      else
        this.fadeTimer = setInterval(() => {
          const k = Math.min(1, (performance.now() - t0) / ms)
          a.volume = from + (to - from) * k
          if (k >= 1) clearInterval(this.fadeTimer)
        }, 16)
    }
    // setTimeout, not rAF: fades must finish in background tabs or auto-advance would stay muted.
    return new Promise<void>((r) => setTimeout(r, ms))
  }

  /** Tune to a preview URL. Reuses the single element, so rapid tuning can never stack players. */
  async load(url: string) {
    this.ensure()
    const id = ++this.seq
    const a = this.audio!
    this.progress = 0
    this.set({ buffering: true })
    if (!a.paused) await this.fade(0, 140)
    if (id !== this.seq) return
    void this.fade(0, 0)
    a.src = url
    try {
      await a.play()
    } catch {
      return // AbortError: a newer tune or a pause replaced this one
    }
    if (id !== this.seq) return
    void this.fade(1, 320)
  }

  resume() {
    this.ensure()
    const id = ++this.seq
    const a = this.audio!
    if (!a.getAttribute("src")) return false
    void this.fade(0, 0)
    a.play().then(
      () => {
        if (id === this.seq) void this.fade(1, 220)
      },
      () => {},
    )
    return true
  }

  async pause() {
    const a = this.audio
    if (!a) return
    const id = ++this.seq
    await this.fade(0, 110)
    if (id === this.seq) a.pause()
  }

  /** Tuning noise + music dip while the needle is between stations. amount 0..1, null = done. */
  scrub(amount: number | null) {
    if (!this.audio) return
    if (amount === null) {
      this.hiss(0)
      if (!this.audio.paused) void this.fade(1, 200)
      return
    }
    this.hiss(amount)
    if (!this.audio.paused) void this.fade(1 - 0.8 * Math.max(0.35, amount), 60)
  }

  /** A short burst of static for keyboard / wheel tuning. */
  blip() {
    if (!this.ctx) return
    this.hiss(0.55)
    setTimeout(() => this.hiss(0), 170)
  }

  private hiss(amount: number) {
    const ctx = this.ctx
    if (!ctx) return
    if (!this.hissGain) {
      const buf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate)
      const d = buf.getChannelData(0)
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1
      const src = ctx.createBufferSource()
      src.buffer = buf
      src.loop = true
      const band = ctx.createBiquadFilter()
      band.type = "bandpass"
      band.frequency.value = 2400
      band.Q.value = 0.6
      this.hissGain = ctx.createGain()
      this.hissGain.gain.value = 0
      src.connect(band).connect(this.hissGain).connect(ctx.destination)
      src.start()
    }
    this.hissGain.gain.setTargetAtTime(amount * 0.09, ctx.currentTime, 0.025)
  }

  /** Fills `out` with spectrum bytes. Returns false when there is no live signal (draw the synth). */
  read(out: Uint8Array<ArrayBuffer>) {
    const a = this.audio
    if (!this.analyser || !a || a.paused) return false
    this.analyser.getByteFrequencyData(out)
    let sum = 0
    for (let i = 0; i < out.length; i++) sum += out[i]
    // A tainted (CORS-blocked) element routed through Web Audio outputs exact zeros. Seen for 2.5s
    // while the clock runs, assume that happened and fall back before the listener notices.
    if (sum === 0 && a.currentTime > 1) {
      const now = performance.now()
      if (!this.silentSince) this.silentSince = now
      else if (now - this.silentSince > 2500) {
        this.silentSince = 0
        this.fallback()
      }
      return false
    }
    this.silentSince = 0
    return true
  }

  get time() {
    return this.audio?.currentTime ?? 0
  }

  dispose() {
    ++this.seq
    clearInterval(this.fadeTimer)
    if (this.audio) {
      this.audio.pause()
      this.audio.removeAttribute("src")
      this.audio.load()
    }
    void this.ctx?.close().catch(() => {})
    this.audio = null
    this.ctx = null
  }
}
