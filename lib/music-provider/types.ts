export interface Artist {
  id: string           // Spotify artist ID
  name: string
  genres: string[]
  imageUrl: string | null
  popularity: number   // 0-100
}

export interface Track {
  id: string                         // source-specific ID (iTunes trackId, Spotify id, …)
  spotifyTrackId: string | null      // null until JIT-resolved; set when the track is known on Spotify
  name: string
  previewUrl: string | null
  durationMs: number
  albumName: string
  albumImageUrl: string | null
  source: 'itunes' | 'spotify' | 'deezer'
}

export interface ArtistWithTracks extends Artist {
  topTracks: Track[]
}

export interface PlayHistory {
  artistId: string
  artistName: string
  playedAt: string  // ISO timestamp
}
