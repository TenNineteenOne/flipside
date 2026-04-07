import { Artist, ArtistWithTracks, PlayHistory, Track } from "./types"

export type { Artist, ArtistWithTracks, PlayHistory, Track }

/** Sentinel returned by rate-limited calls. */
export interface RateLimited {
  rateLimited: true
  /** Value of the Spotify `Retry-After` header in seconds (default 10). */
  retryAfterSec: number
}

export function isRateLimited(x: unknown): x is RateLimited {
  return typeof x === "object" && x !== null && (x as RateLimited).rateLimited === true
}

export interface MusicProvider {
  /** Get user's top artists for a given time range */
  getTopArtists(accessToken: string, term: 'short_term' | 'medium_term' | 'long_term'): Promise<Artist[]>

  /** Get similar artists — uses Last.fm getSimilar as primary, Spotify genre search as secondary */
  getSimilarArtists(accessToken: string, artistId: string, artistName: string, genres?: string[]): Promise<Artist[]>

  /** Get the user's country/market from their Spotify profile */
  getUserMarket(accessToken: string): Promise<string>

  /** Get recently played artists (deduplicated) */
  getRecentlyPlayed(accessToken: string): Promise<PlayHistory[]>

  /** Fetch full artist objects by IDs (batch, up to 50 per call). Always includes genres. */
  getArtists(accessToken: string, ids: string[]): Promise<Artist[]>

  /** Get similar artist names from Last.fm (no Spotify call, no access token needed) */
  getSimilarArtistNames(artistName: string): Promise<string[]>

  /**
   * Search for artists by name. Returns a `RateLimited` sentinel with the
   * `Retry-After` value (seconds) when Spotify returns 429.
   */
  searchArtists(accessToken: string, query: string): Promise<Artist[] | RateLimited>

  /** Get top tracks for an artist. Fetch up to `limit` tracks. */
  getArtistTopTracks(accessToken: string, artistId: string, limit: number, market?: string): Promise<Track[]>

  /** Create a new playlist for the user, return playlist ID */
  createPlaylist(accessToken: string, userId: string, name: string): Promise<string>

  /** Add tracks to an existing playlist */
  addTracksToPlaylist(accessToken: string, playlistId: string, trackUris: string[]): Promise<void>

  /** Save a track to the user's Spotify Liked Songs. Throws typed errors: 'auth_expired' | 'scope_missing' | 'rate_limited' | 'http_N' */
  likeTrack(accessToken: string, trackId: string): Promise<void>
}
