import { Artist, ArtistWithTracks, PlayHistory, Track } from "./types"

export type { Artist, ArtistWithTracks, PlayHistory, Track }

export interface MusicProvider {
  /** Get user's top artists for a given time range */
  getTopArtists(accessToken: string, term: 'short_term' | 'medium_term' | 'long_term'): Promise<Artist[]>

  /** Get similar artists — uses Last.fm getSimilar as primary, Spotify Recommendations as secondary */
  getSimilarArtists(artistId: string, artistName: string): Promise<Artist[]>

  /** Get recently played artists (deduplicated) */
  getRecentlyPlayed(accessToken: string): Promise<PlayHistory[]>

  /** Search for artists by name */
  searchArtists(accessToken: string, query: string): Promise<Artist[]>

  /** Get top tracks for an artist. Fetch up to `limit` tracks. */
  getArtistTopTracks(accessToken: string, artistId: string, limit: number): Promise<Track[]>

  /** Create a new playlist for the user, return playlist ID */
  createPlaylist(accessToken: string, userId: string, name: string): Promise<string>

  /** Add tracks to an existing playlist */
  addTracksToPlaylist(accessToken: string, playlistId: string, trackUris: string[]): Promise<void>
}
