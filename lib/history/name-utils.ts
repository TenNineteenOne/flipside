// Minimum name-similarity ratio (0–1) to accept a Spotify search result as a match.
// Uses Dice coefficient on character bigrams.
export const SIMILARITY_THRESHOLD = 0.8

/** Dice-coefficient similarity between two strings (case-insensitive). */
export function stringSimilarity(a: string, b: string): number {
  const normalize = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim()
  const na = normalize(a)
  const nb = normalize(b)
  if (na === nb) return 1
  if (na.length < 2 || nb.length < 2) return 0

  const bigrams = (s: string): Map<string, number> => {
    const m = new Map<string, number>()
    for (let i = 0; i < s.length - 1; i++) {
      const bg = s.slice(i, i + 2)
      m.set(bg, (m.get(bg) ?? 0) + 1)
    }
    return m
  }

  const ma = bigrams(na)
  const mb = bigrams(nb)
  let intersection = 0
  for (const [bg, count] of ma) {
    intersection += Math.min(count, mb.get(bg) ?? 0)
  }
  return (2 * intersection) / (na.length - 1 + (nb.length - 1))
}

// Normalize artist name for Last.fm matching (lowercase, strip punctuation, trim)
export function normalizeArtistName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^\w\s]/g, "")
    .trim()
}
