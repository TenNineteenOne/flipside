/**
 * Spotify IDs are base62 strings of exactly 22 characters.
 */
const SPOTIFY_ID_RE = /^[a-zA-Z0-9]{22}$/

export function isValidSpotifyId(id: string): boolean {
  return SPOTIFY_ID_RE.test(id)
}

/**
 * Internal artist identity (Stage 2): a strict lowercase UUID v4. The version
 * (`4`) and variant (`[89ab]`) bits are pinned, so this doubles as a
 * path-traversal / injection guard on routes that take an artist id in the URL.
 * Distinct from {@link isValidSpotifyId} — Spotify ids stay valid only on the
 * genuine-Spotify routes (open-link, track resolve) until those are re-keyed.
 */
const ARTIST_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

export function isValidArtistId(id: string): boolean {
  return ARTIST_ID_RE.test(id)
}
