/**
 * Shared color utility functions used across feed, history, and saved views.
 */

/** Validate and sanitize a hex color string. Returns fallback if invalid. */
export function sanitizeHex(color: string | null | undefined, fallback = "#8b5cf6"): string {
  return color && /^#[0-9a-fA-F]{6}$/.test(color) ? color : fallback
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
