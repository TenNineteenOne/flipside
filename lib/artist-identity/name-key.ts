/**
 * Artist-name keys. Two, deliberately distinct:
 *
 *  - `artistNameKey`   — THE in-code "same artist name?" key (listened-artist
 *    filter, Last.fm / MusicBrainz result matching, history matching).
 *  - `artistNameDbKey` — the `artists.name_lower` column value. Never use it to
 *    compare names in code; never use `artistNameKey` to read/write the column.
 */

/**
 * Unicode-aware comparison key: NFKC, lowercased, punctuation/symbols dropped
 * (letters, marks, digits, `_` and whitespace kept), trimmed. Internal
 * whitespace is NOT collapsed and "&" is NOT equated with "and" — on ASCII
 * input this is byte-identical to the old `/[^\w\s]/g` normalizer, so it
 * matches exactly the names that matched before. What changed: non-ASCII
 * letters survive ("Björk" → "björk", not "bjrk"; all-CJK/Cyrillic names no
 * longer collapse to ""), and a non-blank name never keys to "" — an
 * all-punctuation name ("!!!") falls back to its folded form. A "" key in the
 * listened set used to drop every all-CJK candidate from the feed.
 */
export function artistNameKey(name: string): string {
  const folded = name.normalize("NFKC").toLowerCase().trim()
  return folded.replace(/[^\p{L}\p{M}\p{N}_\s]/gu, "").trim() || folded
}

/**
 * The `artists.name_lower` column value. Exactly `name.toLowerCase()` — existing
 * rows were written this way and there is no backfill, so the DB key must never
 * change.
 */
export function artistNameDbKey(name: string): string {
  return name.toLowerCase()
}

// Minimum name-similarity ratio (0–1) to accept a fuzzy search result as a match.
// Uses Dice coefficient on character bigrams.
export const SIMILARITY_THRESHOLD = 0.8

/**
 * Dice-coefficient similarity between two strings (case-insensitive). A fuzzy
 * score, not an identity key — its own light normalization (case + whitespace)
 * is intentional and unchanged, so acceptance thresholds keep their meaning.
 */
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
