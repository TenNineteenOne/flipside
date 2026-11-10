/** Landing sample (PRD #182, Modules 5): static artists for the public hero card. */
import type { CSSProperties } from "react"
import raw from "@/data/landing-sample.json"
import { resolveArtistColor } from "@/lib/color-utils"

export interface LandingTrack {
  id: string
  name: string
  previewUrl: string
  durationMs: number
  albumName: string
}

export interface LandingArtist {
  id: string
  name: string
  genres: string[]
  popularity: number
  imageUrl: string
  color: string
  why: { sourceArtists: string[]; genres: string[] }
  tracks: LandingTrack[]
}

export interface LandingSample {
  /** The hero card stack, in play order. */
  artists: LandingArtist[]
  /** The mini queue illustrating step 3 of the explainer. */
  queue: LandingArtist[]
}

export const landingSample = raw as LandingSample

/** `--a` drives every artist tint; landing.css derives --a-dark / --a-light from it. */
export function artistVars(a: LandingArtist): CSSProperties {
  return { "--a": resolveArtistColor(a.color, a.name) } as CSSProperties
}

// Must stay inside the Content-Security-Policy's img-src / media-src.
const IMAGE_HOST = (h: string) => h.endsWith(".mzstatic.com")
const AUDIO_HOST = (h: string) => h === "audio-ssl.itunes.apple.com" || h.endsWith(".mzstatic.com")

function urlProblem(value: unknown, allowed: (host: string) => boolean): string | null {
  if (typeof value !== "string") return "missing"
  try {
    const u = new URL(value)
    if (u.protocol !== "https:") return `not https: ${value}`
    if (u.port || u.username || u.password) return "has a port or credentials"
    return allowed(u.hostname) ? null : `disallowed host: ${u.hostname}`
  } catch {
    return `not a URL: ${value}`
  }
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null
const isStrList = (v: unknown) => Array.isArray(v) && v.every((s) => typeof s === "string")

function artistProblems(a: unknown, at: string): string[] {
  if (!isObj(a)) return [`${at}: not an object`]
  const out: string[] = []
  for (const k of ["id", "name", "color"] as const) if (typeof a[k] !== "string" || !a[k]) out.push(`${at}: missing ${k}`)
  if (!isStrList(a.genres) || (a.genres as string[]).length === 0) out.push(`${at}: missing genres`)
  if (!Number.isFinite(a.popularity)) out.push(`${at}: missing popularity`)
  const img = urlProblem(a.imageUrl, IMAGE_HOST)
  if (img) out.push(`${at}: imageUrl ${img}`)
  if (!isObj(a.why) || !isStrList(a.why.sourceArtists) || !isStrList(a.why.genres)) out.push(`${at}: missing why`)
  if (!Array.isArray(a.tracks) || a.tracks.length === 0) return [...out, `${at}: no tracks`]
  if (a.tracks.length > 3) out.push(`${at}: more than 3 tracks`)
  a.tracks.forEach((t: unknown, i: number) => {
    const tat = `${at} track ${i}`
    if (!isObj(t)) return out.push(`${tat}: not an object`)
    for (const k of ["id", "name", "albumName"] as const) if (typeof t[k] !== "string" || !t[k]) out.push(`${tat}: missing ${k}`)
    if (!Number.isFinite(t.durationMs) || (t.durationMs as number) <= 0) out.push(`${tat}: missing durationMs`)
    const audio = urlProblem(t.previewUrl, AUDIO_HOST)
    if (audio) out.push(`${tat}: previewUrl ${audio}`)
  })
  return out
}

/** Every problem with a landing sample; an empty list means it is safe to ship. */
export function validateLandingSample(data: unknown): string[] {
  if (!isObj(data)) return ["sample: not an object"]
  const out: string[] = []
  for (const list of ["artists", "queue"] as const) {
    const items = data[list]
    if (!Array.isArray(items) || items.length === 0) out.push(`${list}: empty list`)
    else items.forEach((a, i) => out.push(...artistProblems(a, `${list}[${i}]`)))
  }
  return out
}
