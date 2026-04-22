/**
 * Shared genre-string normalization for COMPARISON only.
 *
 * Raw genre strings arrive in three formats across the stack:
 * - Spotify artist `genres[]`: mixed case, sometimes with spaces (`"Indie Rock"`)
 * - Last.fm tag strings:        lowercase with hyphens (`"indie-rock"`)
 * - User-stored `selected_genres`: whatever lastfmTag was (usually hyphenated)
 *
 * `normalizeGenre` returns a canonical comparison form so equality and
 * substring checks work across sources. Raw values are never mutated.
 */

export function normalizeGenre(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function normalizedEquals(a: string, b: string): boolean {
  return normalizeGenre(a) === normalizeGenre(b)
}

/**
 * Substring check over normalized forms. Preserves the intentional
 * semantics of the genre-filter chip: filtering "rock" matches
 * "indie-rock", "garage rock", etc.
 */
export function normalizedIncludes(haystack: string, needle: string): boolean {
  const n = normalizeGenre(needle)
  if (!n) return true
  return normalizeGenre(haystack).includes(n)
}
