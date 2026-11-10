import { labArtists, type LabArtist } from "@/lib/lab/artists"

/** A new drop lands at 08:00 local time; before that you're still on yesterday's. */
export const DROP_HOUR = 8
const EPOCH = Date.UTC(2026, 3, 6) // Drop Nº 1 = Mon 6 Apr 2026, so Mon 9 Nov 2026 = Nº 218
const DAY = 864e5

export type Verdict = "keep" | "pass" | "save" | "skip"
export interface Entry { id: string; day: number; verdict: Verdict; bonus?: boolean }
export interface DropStore { history: Entry[]; done: number[] }

export function dropDay(now: Date = new Date()): number {
  const t = new Date(now.getTime() - DROP_HOUR * 3600e3)
  return Math.round((Date.UTC(t.getFullYear(), t.getMonth(), t.getDate()) - EPOCH) / DAY)
}
export const edition = (day: number) => day + 1
export function dayLabel(day: number) {
  return new Date(EPOCH + day * DAY).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" })
}
export function nextDropAt(now: Date): Date {
  const t = new Date(now)
  t.setHours(DROP_HOUR, 0, 0, 0)
  if (t <= now) t.setDate(t.getDate() + 1)
  return t
}

function rng(seed: number) {
  let a = (seed * 2654435761) >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
/** Everyone gets the same five on the same day (that's what makes the result shareable). */
export function crateFor(day: number): LabArtist[] {
  const r = rng(day + 1)
  const a = [...labArtists]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}
export const byId = (id: string) => labArtists.find((a) => a.id === id)

/** Spot-ink for an artist: its own colour, unless the artwork is grey, then a riso ink. */
const RISO_FALLBACK = ["#00a95c", "#00838a", "#ff6c2f"]
export function inkOf(a: LabArtist): string {
  const [r, g, b] = rgb(a.color)
  if (Math.max(r, g, b) - Math.min(r, g, b) > 0.12) return a.color
  return RISO_FALLBACK[a.id.length % RISO_FALLBACK.length]
}
export function rgb(hex: string): [number, number, number] {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as [number, number, number]
}

export const VERDICT_WORD: Record<Verdict, string> = { keep: "Keep", pass: "Pass", save: "On the wall", skip: "Not today" }
const SQUARE: Record<Verdict, string> = { keep: "🟩", pass: "⬛", save: "🟨", skip: "⬜" }

export function todayEntries(store: DropStore, day: number) {
  return store.history.filter((e) => e.day === day && !e.bonus)
}

export function streakOf(done: number[], today: number): number {
  const set = new Set(done)
  let d = set.has(today) ? today : today - 1 // an unfinished today doesn't break the streak yet
  let n = 0
  while (set.has(d)) { n++; d-- }
  return n
}

export function shareText(day: number, entries: Entry[], streak: number, url: string) {
  const kept = entries.filter((e) => e.verdict === "keep").length
  const saved = entries.filter((e) => e.verdict === "save").length
  return [
    `Flipside Drop Nº ${edition(day)} · ${dayLabel(day)}`,
    entries.map((e) => SQUARE[e.verdict]).join(""),
    `${kept} kept · ${saved} on the wall · ${streak}-day streak`,
    url,
  ].join("\n")
}

const KEY = "flipside-drop-v1"
export const emptyStore: DropStore = { history: [], done: [] }
export function loadStore(): DropStore {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) return { ...emptyStore, ...JSON.parse(raw) }
  } catch {}
  return emptyStore
}
export function saveStore(s: DropStore) {
  try { localStorage.setItem(KEY, JSON.stringify(s)) } catch {}
}

/** `?demo=result`: a finished drop, a 9-day streak and a populated wall, for screenshots. `?demo=mid`: two of five decided. */
export function demoStore(day: number, partial = false): DropStore {
  const crate = crateFor(day)
  const verdicts: Verdict[] = ["keep", "pass", "save", "keep", "skip"]
  const history: Entry[] = []
  for (let back = 6; back >= 1; back--) {
    const c = crateFor(day - back)
    history.push({ id: c[0].id, day: day - back, verdict: back % 2 ? "keep" : "save" })
  }
  crate.slice(0, partial ? 2 : 5).forEach((a, i) => history.push({ id: a.id, day, verdict: verdicts[i] }))
  const done = [...Array(9)].map((_, i) => day - i).filter((d) => !partial || d !== day).concat([day - 11, day - 12, day - 15, day - 16, day - 17, day - 22])
  return { history, done }
}
