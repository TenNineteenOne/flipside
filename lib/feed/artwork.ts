/**
 * Artwork for an artist card (PRD #182, Modules 3): the artist image, else the
 * first track's album image, else null (the UI then shows a colour panel with
 * the artist's first letter, never a broken image). Empty strings count as missing.
 */
export function artworkFor(artist: {
  imageUrl: string | null
  topTracks: readonly { albumImageUrl: string | null }[]
}): string | null {
  return artist.imageUrl || artist.topTracks[0]?.albumImageUrl || null
}

/** Shown on the no-artwork panel when the name has nothing visible. */
export const NO_LETTER = "♪"

/**
 * The letter on the no-artwork panel: the name's first letter or number
 * (skipping quotes, punctuation, emoji and invisible characters), else its
 * first visible grapheme, else NO_LETTER. Upper-cased with the locale-free
 * `toUpperCase` (a Turkish-locale browser would otherwise render "İ" and break
 * hydration), and kept as is when upper-casing would make it longer ("ß" → "SS").
 */
export function letterFor(name: string): string {
  // Intl.Segmenter is missing before Firefox 125: fall back to code points.
  const graphemes =
    typeof Intl.Segmenter === "function"
      ? Array.from(new Intl.Segmenter().segment(name), (s) => s.segment)
      : Array.from(name)
  const first =
    graphemes.find((g) => /^[\p{L}\p{N}]/u.test(g)) ??
    graphemes.find((g) => /[^\s\p{Cc}\p{Cf}]/u.test(g))
  if (!first) return NO_LETTER
  const upper = first.toUpperCase()
  return upper.length === first.length ? upper : first
}

/** Apple's image CDN serves any square size by URL: `…/<w>x<h>bb.jpg` (also .png / .webp). */
const MZSTATIC_SIZE = /\/(\d+)x(\d+)bb\.(jpg|png|webp)$/

/**
 * The artwork URL for an image displayed at `px` CSS pixels: Apple (`*.mzstatic.com`)
 * artwork is requested at three times that for thumbnails of 64px or less (sharp on 3x
 * phone screens, still a few kB) and twice that for larger artwork, instead of the
 * stored 600x600, so a 48px thumbnail fetches a few kB instead of ~100 kB. Never
 * asks for more than the stored size. Anything else (Spotify `i.scdn.co`, an
 * unrecognised shape, null) is returned unchanged.
 */
export function artworkAt<T extends string | null>(url: T, px: number): T {
  if (!url) return url
  let host: string
  try {
    host = new URL(url).hostname
  } catch {
    return url
  }
  if (!host.endsWith(".mzstatic.com")) return url
  const m = MZSTATIC_SIZE.exec(url)
  if (!m) return url
  const want = Math.ceil(px * (px <= 64 ? 3 : 2))
  if (want >= Number(m[1]) || want >= Number(m[2])) return url
  return url.replace(MZSTATIC_SIZE, `/${want}x${want}bb.${m[3]}`) as T
}
