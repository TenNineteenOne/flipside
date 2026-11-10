import type { CSSProperties } from "react"
import type { LabArtist } from "@/lib/lab/artists"

export function Wordmark({ size = "md" }: { size?: "md" | "lg" }) {
  return (
    <span className={`ev-wordmark ev-wordmark-${size}`} aria-label="flipside">
      flipside<span className="ev-dot" aria-hidden />
    </span>
  )
}

/** Per-artist palette as CSS custom properties; everything that tints reads these. */
export function artistVars(a: LabArtist): CSSProperties {
  return { "--a": a.color, "--a-dark": a.colorDark, "--a-light": a.colorLight } as CSSProperties
}

export function whyText(a: LabArtist) {
  const s = a.why.sourceArtists
  if (s.length === 0) return `Because you like ${a.why.genres.join(", ")}`
  return `Because you like ${s.length > 1 ? `${s.slice(0, -1).join(", ")} and ${s[s.length - 1]}` : s[0]}`
}

export function popularityLabel(p: number) {
  if (p < 35) return "Barely charted"
  if (p < 45) return "Deep cut"
  if (p < 52) return "Under the radar"
  return "Cult following"
}

export function duration(ms: number) {
  const s = Math.round(ms / 1000)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`
}

export function spotifyUrl(a: LabArtist) {
  return `https://open.spotify.com/search/${encodeURIComponent(a.name)}/artists`
}

/** Small "keycap" hint, hidden on touch layouts via CSS. */
export function Kbd({ children }: { children: React.ReactNode }) {
  return <kbd className="ev-kbd">{children}</kbd>
}
