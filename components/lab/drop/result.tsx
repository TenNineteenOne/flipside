"use client"

import { useState, useSyncExternalStore } from "react"
import { Check, Copy, Pause, Play, Share2 } from "lucide-react"
import { useAudio } from "@/lib/audio-context"
import type { LabArtist } from "@/lib/lab/artists"
import { byId, dayLabel, edition, inkOf, nextDropAt, shareText, type Entry } from "./drop-core"
import { Art } from "./ink"

const MARK: Record<Entry["verdict"], string> = { keep: "Kept", pass: "Passed", save: "On the wall", skip: "Not today" }

/** The thing people post: a pocket gig poster of today's five decisions. */
export function SharePoster({ day, entries, streak, url }: { day: number; entries: Entry[]; streak: number; url: string }) {
  const kept = entries.filter((e) => e.verdict === "keep").length
  const saved = entries.filter((e) => e.verdict === "save").length
  return (
    <figure className="d-share" aria-label={`Drop Nº ${edition(day)} result card`}>
      <div className="d-share-head">
        <span className="d-share-brand">Flipside</span>
        <span className="d-share-no">Nº {edition(day)}</span>
      </div>
      <p className="d-share-date">The Daily Drop · {dayLabel(day)}</p>
      <ol className="d-blocks">
        {Array.from({ length: 5 }, (_, i) => {
          const e = entries[i]
          const a = e && byId(e.id)
          return (
            <li key={i} className={`d-block is-${e?.verdict ?? "empty"}`} style={{ ["--ink" as string]: a ? inkOf(a) : "transparent" }}>
              <span className="sr">{e && a ? `${a.name}: ${MARK[e.verdict]}` : "Not decided yet"}</span>
            </li>
          )
        })}
      </ol>
      <p className="d-share-tally">
        <b>{kept}</b> kept · <b>{saved}</b> on the wall · <b>{streak}</b>-day streak
      </p>
      <p className="d-share-url">{url.replace(/^https?:\/\//, "")}</p>
    </figure>
  )
}

export function ShareActions({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    } catch {}
  }
  const share = async () => {
    try {
      if (navigator.share) await navigator.share({ text })
      else await copy()
    } catch {}
  }
  return (
    <div className="d-share-actions">
      <button type="button" className="d-btn is-keep" onClick={copy}>
        {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />} {copied ? "Copied" : "Copy result"}
      </button>
      <button type="button" className="d-btn is-pass" onClick={share}><Share2 aria-hidden="true" /> Share</button>
      <span className="sr" aria-live="polite">{copied ? "Result copied to clipboard" : ""}</span>
    </div>
  )
}

export { shareText }

const tick = (cb: () => void) => {
  const id = setInterval(cb, 1000)
  return () => clearInterval(id)
}
const noop = () => () => {}
export const useOrigin = () => useSyncExternalStore(noop, () => location.origin, () => "")
const nowSec = () => Math.floor(Date.now() / 1000)

export function Countdown() {
  const s = useSyncExternalStore(tick, nowSec, () => 0)
  if (!s) return <span className="d-count">--:--:--</span>
  const left = Math.max(0, Math.floor(nextDropAt(new Date(s * 1000)).getTime() / 1000) - s)
  const pad = (n: number) => String(n).padStart(2, "0")
  return (
    <span className="d-count" role="timer" aria-label="Time until the next drop">
      {pad(Math.floor(left / 3600))}:{pad(Math.floor((left % 3600) / 60))}:{pad(left % 60)}
    </span>
  )
}

/** Last five weeks, Monday-first, like a tour-date grid. */
export function StreakCalendar({ today, done }: { today: number; done: number[] }) {
  const set = new Set(done)
  // day 0 is a Monday, so (day % 7) is the weekday column
  const start = today - (today % 7) - 28
  return (
    <div className="d-cal" role="img" aria-label={`${done.filter((d) => d > today - 35).length} drops finished in the last five weeks`}>
      {["M", "T", "W", "T", "F", "S", "S"].map((d, i) => <span key={i} className="d-cal-h" aria-hidden="true">{d}</span>)}
      {Array.from({ length: 35 }, (_, i) => {
        const d = start + i
        return <span key={i} className={`d-cal-d${set.has(d) ? " is-on" : ""}${d === today ? " is-today" : ""}${d > today ? " is-future" : ""}`} />
      })}
    </div>
  )
}

/** Everything you kept or pinned, as mini posters you can replay. */
export function Wall({ entries, limit }: { entries: Entry[]; limit?: number }) {
  const audio = useAudio()
  const seen = new Set<string>()
  const items = entries
    .filter((e) => e.verdict === "keep" || e.verdict === "save")
    .reverse()
    .map((e) => ({ e, a: byId(e.id) }))
    .filter((x): x is { e: Entry; a: LabArtist } => !!x.a && !seen.has(x.a.id) && !!seen.add(x.a.id))
    .slice(0, limit)
  if (!items.length) return <p className="d-empty">Nothing on the wall yet. Keep an artist (→) or pin one (↑) and it lands here.</p>
  return (
    <ul className="d-wall">
      {items.map(({ e, a }) => {
        const t = a.topTracks[0]
        const on = audio.currentTrack?.id === t?.id && audio.isPlaying
        return (
          <li key={a.id} style={{ ["--ink" as string]: inkOf(a) }}>
            <button
              type="button"
              className="d-mini"
              onClick={() => (on ? audio.pause() : t && audio.play(t, a.name, a.imageUrl, a.color))}
              aria-label={`${on ? "Pause" : "Play"} ${a.name}`}
            >
              <Art artist={a} />
              <span className="d-mini-name">{a.name}</span>
              <span className="d-mini-meta">Nº {edition(e.day)}{e.verdict === "save" ? " · pinned" : ""}</span>
              <span className="d-mini-play" aria-hidden="true">{on ? <Pause /> : <Play />}</span>
            </button>
          </li>
        )
      })}
    </ul>
  )
}
