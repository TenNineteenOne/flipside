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
