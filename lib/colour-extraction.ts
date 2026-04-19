/**
 * Server-only colour extraction module.
 * Extracts a dominant vibrant colour from an artist image URL,
 * ensures WCAG AA contrast against #000000, and returns a hex string.
 * Never import this from client components.
 */

const FALLBACK = '#8b5cf6'

/**
 * Compute relative luminance of an sRGB colour (each channel 0–255).
 * https://www.w3.org/TR/WCAG20/#relativeluminancedef
 */
function relativeLuminance(r: number, g: number, b: number): number {
  const linearise = (c: number): number => {
    const s = c / 255
    return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
  }
  return 0.2126 * linearise(r) + 0.7152 * linearise(g) + 0.0722 * linearise(b)
}

/**
 * WCAG AA contrast ratio against black (#000000).
 * Black has luminance 0, so: (L + 0.05) / (0 + 0.05)
 */
function contrastAgainstBlack(r: number, g: number, b: number): number {
  const L = relativeLuminance(r, g, b)
  return (L + 0.05) / 0.05
}

/** Convert hex string (#rrggbb) to [r, g, b] 0–255. */
function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16)
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff]
}

/** Convert [r, g, b] 0–255 to #rrggbb hex string. */
function rgbToHex(r: number, g: number, b: number): string {
  return '#' + [r, g, b].map(c => c.toString(16).padStart(2, '0')).join('')
}

/** Convert RGB (0–255 each) to HSL (h: 0–360, s: 0–1, l: 0–1). */
function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const rn = r / 255, gn = g / 255, bn = b / 255
  const max = Math.max(rn, gn, bn), min = Math.min(rn, gn, bn)
  const l = (max + min) / 2
  if (max === min) return [0, 0, l]
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  let h: number
  if (max === rn) h = ((gn - bn) / d + (gn < bn ? 6 : 0)) / 6
  else if (max === gn) h = ((bn - rn) / d + 2) / 6
  else h = ((rn - gn) / d + 4) / 6
  return [h * 360, s, l]
}

/** Convert HSL (h: 0–360, s: 0–1, l: 0–1) to RGB (0–255 each). */
function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const hue = h / 360
  if (s === 0) {
    const v = Math.round(l * 255)
    return [v, v, v]
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s
  const p = 2 * l - q
  const hue2rgb = (t: number): number => {
    if (t < 0) t += 1
    if (t > 1) t -= 1
    if (t < 1 / 6) return p + (q - p) * 6 * t
    if (t < 1 / 2) return q
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6
    return p
  }
  return [
    Math.round(hue2rgb(hue + 1 / 3) * 255),
    Math.round(hue2rgb(hue) * 255),
    Math.round(hue2rgb(hue - 1 / 3) * 255),
  ]
}

/**
 * Lighten `hex` in HSL space by 5% steps until it passes WCAG AA contrast
 * against black (≥ 4.5:1) or reaches L=100%.
 * Returns the lightened hex, or FALLBACK if it never passes.
 */
function lightenToContrast(hex: string): string {
  let [r, g, b] = hexToRgb(hex)
  const [h, s] = rgbToHsl(r, g, b)
  let l = rgbToHsl(r, g, b)[2]

  while (l <= 1.0) {
    if (contrastAgainstBlack(r, g, b) >= 4.5) {
      return rgbToHex(r, g, b)
    }
    l = Math.min(1.0, l + 0.05)
    ;[r, g, b] = hslToRgb(h, s, l)
    if (l >= 1.0) {
      // Final check at L=100%
      if (contrastAgainstBlack(r, g, b) >= 4.5) return rgbToHex(r, g, b)
      break
    }
  }
  return FALLBACK
}

/**
 * Extract dominant vibrant accent colour from `imageUrl`.
 * Ensures WCAG AA contrast against #000000. Falls back to #8b5cf6 on any error.
 */
const ALLOWED_IMAGE_HOSTS = new Set([
  "i.scdn.co",
  "mosaic.scdn.co",
  "is1-ssl.mzstatic.com",
  "is2-ssl.mzstatic.com",
  "is3-ssl.mzstatic.com",
  "is4-ssl.mzstatic.com",
  "is5-ssl.mzstatic.com",
])

export async function extractArtistColor(imageUrl: string): Promise<string> {
  try {
    const parsed = new URL(imageUrl)
    if (parsed.protocol !== "https:" || !ALLOWED_IMAGE_HOSTS.has(parsed.hostname)) {
      console.warn(`[colour] blocked fetch to untrusted host: ${parsed.hostname}`)
      return FALLBACK
    }

    const res = await fetch(imageUrl, {
      headers: { "User-Agent": "Mozilla/5.0" },
      redirect: "error",
      signal: AbortSignal.timeout(8000),
    })
    if (!res.ok) throw new Error(`Fetch failed with status ${res.status}`)
    const arrayBuffer = await res.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)

    // Dynamic import keeps node-vibrant out of the client bundle.
    // Must use the /node subpath — the default export throws on import.
    const { Vibrant } = await import('node-vibrant/node')
    const palette = await Vibrant.from(buffer).getPalette()

    const swatch =
      palette.Vibrant ??
      palette.LightVibrant ??
      palette.Muted ??
      palette.LightMuted ??
      palette.DarkVibrant ??
      palette.DarkMuted

    if (!swatch) return FALLBACK

    const r = Math.round(swatch.rgb[0])
    const g = Math.round(swatch.rgb[1])
    const b = Math.round(swatch.rgb[2])
    const hex = rgbToHex(r, g, b)

    if (contrastAgainstBlack(r, g, b) >= 4.5) {
      return hex
    }

    return lightenToContrast(hex)
  } catch {
    return FALLBACK
  }
}
