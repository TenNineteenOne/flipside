// Drenched surfaces: the page takes each record's own colour, so ink is computed, never assumed.
import type { CSSProperties } from "react"
import type { LabArtist } from "@/lib/lab/artists"

const INK_DARK = "#14110f"
const INK_LIGHT = "#ffffff"

function luminance(hex: string) {
  const n = parseInt(hex.slice(1), 16)
  const [r, g, b] = [n >> 16, (n >> 8) & 255, n & 255].map((c) => {
    const s = c / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

export function contrast(a: string, b: string) {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p)
  return (x + 0.05) / (y + 0.05)
}

/** Whichever of near-black / white reads better on `bg`. One of them always clears 4.5:1. */
export function inkFor(bg: string) {
  return contrast(INK_DARK, bg) >= contrast(INK_LIGHT, bg) ? INK_DARK : INK_LIGHT
}

/** CSS variables for one record: page drench, sleeve back, vinyl label. */
export function themeVars(a: LabArtist): CSSProperties {
  return {
    "--bs-bg": a.color,
    "--bs-ink": inkFor(a.color),
    "--bs-back": a.colorDark,
    "--bs-back-ink": inkFor(a.colorDark),
    "--bs-label": a.colorLight,
    "--bs-label-ink": inkFor(a.colorLight),
  } as CSSProperties
}
