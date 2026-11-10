/**
 * Shared color utility functions used across feed, history, and saved views.
 */

/** Validate and sanitize a hex color string. Returns fallback if invalid. */
export function sanitizeHex(color: string | null | undefined, fallback = "#8b5cf6"): string {
  return color && /^#[0-9a-fA-F]{6}$/.test(color) ? color : fallback
}

/**
 * The one display-colour rule for an artist. sanitizeHex returns "#8b5cf6" as
 * its fallback when the stored color is null, undefined, empty, or invalid;
 * that sentinel (whether stored or produced by the fallback) means "no real
 * color", so fall back to the deterministic name-hash and every artist gets a
 * distinctive tint.
 */
export function resolveArtistColor(rawColor: string | null | undefined, artistName: string): string {
  const sanitized = sanitizeHex(rawColor)
  if (sanitized === "#8b5cf6") return stringToVibrantHex(artistName)
  return sanitized
}

export function stringToVibrantHex(str: string): string {
  let hash = 0
  for (let i = 0; i < str.length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash)
  const hue = Math.abs(hash) % 360
  const s = 0.70, l = 0.65
  const c = (1 - Math.abs(2 * l - 1)) * s
  const x = c * (1 - Math.abs((hue / 60) % 2 - 1))
  const m = l - c / 2
  let r = 0, g = 0, b = 0
  if (hue < 60)       { r = c; g = x; b = 0 }
  else if (hue < 120) { r = x; g = c; b = 0 }
  else if (hue < 180) { r = 0; g = c; b = x }
  else if (hue < 240) { r = 0; g = x; b = c }
  else if (hue < 300) { r = x; g = 0; b = c }
  else                { r = c; g = 0; b = x }
  const toHex = (n: number) => {
    const hex = Math.round((n + m) * 255).toString(16)
    return hex.length === 1 ? "0" + hex : hex
  }
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`
}

export function hexToRgba(hex: string, alpha: number): string {
  const cleaned = hex.replace(/^#/, "")
  const full = cleaned.length === 3 ? cleaned.split("").map((c) => c + c).join("") : cleaned
  const num = parseInt(full.slice(0, 6), 16)
  return `rgba(${(num >> 16) & 0xff}, ${(num >> 8) & 0xff}, ${num & 0xff}, ${alpha})`
}

/** WCAG relative luminance of a #rrggbb colour. */
function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** Text colour (white or near-black) with the higher contrast on a #rrggbb background. */
export function readableTextOn(hex: string): "#ffffff" | "#14121a" {
  const L = luminance(sanitizeHex(hex))
  const ink = luminance("#14121a")
  return (1.05) / (L + 0.05) >= (L + 0.05) / (ink + 0.05) ? "#ffffff" : "#14121a"
}

// Track-chip colours: hand-picked hues at one lightness/chroma, skipping yellow-green (~90–150),
// which turns muddy at this lightness.
const CHIP_HUES = [25, 65, 160, 230, 290, 340]

/** OKLCH hue and chroma of a hex colour. */
function oklchOf(hex: string): { h: number; c: number } {
  const lin = (i: number) => {
    const v = parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) / 255
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
  }
  const [r, g, b] = [lin(0), lin(1), lin(2)]
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s
  return { h: ((Math.atan2(B, A) * 180) / Math.PI + 360) % 360, c: Math.hypot(A, B) }
}

/**
 * Three distinct chip colours turned away from the artist's hue (+100°, +180°, +260°), each snapped
 * to the nearest unused CHIP_HUES entry so every artist gets colours from the same family.
 */
export function chipColors(artistHex: string): [string, string, string] {
  const { h, c } = oklchOf(sanitizeHex(artistHex))
  const base = c < 0.03 ? 65 : h // greys have no real hue: use the orange case (mint, sky, orchid)
  const dist = (x: number, y: number) => Math.min(Math.abs(x - y), 360 - Math.abs(x - y))
  const used: number[] = []
  for (const turn of [100, 180, 260]) {
    const target = (base + turn) % 360
    used.push(CHIP_HUES.filter((x) => !used.includes(x)).sort((x, y) => dist(x, target) - dist(y, target))[0])
  }
  return used.map((hue) => `oklch(0.7 0.14 ${hue})`) as [string, string, string]
}
