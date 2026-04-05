import { Artist, ArtistWithTracks, PlayHistory, Track } from "./types"

export type { Artist, ArtistWithTracks, PlayHistory, Track }

export interface MusicProvider {
  /** Get user's top artists for a given time range */
  getTopArtists(accessToken: string, term: 'short_term' | 'medium_term' | 'long_term'): Promise<Artist[]>

  /** Get similar artists — uses Last.fm getSimilar as primary, Spotify genre search as secondary */
  getSimilarArtists(accessToken: string, artistId: string, artistName: string, genres?: string[]): Promise<Artist[]>

  /** Get the user's country/market from their Spotify profile */
  getUserMarket(accessToken: string): Promise<string>

  /** Get recently played artists (deduplicated) */
  getRecentlyPlayed(accessToken: string): Promise<PlayHistory[]>

  /** Search for artists by name */
  searchArtists(accessToken: string, query: string): Promise<Artist[]>

  /** Get top tracks for an artist. Fetch up to `limit` tracks. */
  getArtistTopTracks(accessToken: string, artistId: string, limit: number, market?: string): Promise<Track[]>

  /** Create a new playlist for the user, return playlist ID */
  createPlaylist(accessToken: string, userId: string, name: string): Promise<string>

  /** Add tracks to an existing playlist */
  addTracksToPlaylist(accessToken: string, playlistId: string, trackUris: string[]): Promise<void>
}
