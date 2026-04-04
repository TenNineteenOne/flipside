/**
 * Spotify IDs are base62 strings of exactly 22 characters.
 */
const SPOTIFY_ID_RE = /^[a-zA-Z0-9]{22}$/

export function isValidSpotifyId(id: string): boolean {
  return SPOTIFY_ID_RE.test(id)
}
