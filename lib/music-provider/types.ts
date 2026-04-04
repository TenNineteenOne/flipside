export interface Artist {
  id: string           // Spotify artist ID
  name: string
  genres: string[]
  imageUrl: string | null
  popularity: number   // 0-100
}

export interface Track {
  id: string           // Spotify track ID
  name: string
  previewUrl: string | null
  durationMs: number
  albumName: string
  albumImageUrl: string | null
}

export interface ArtistWithTracks extends Artist {
  topTracks: Track[]
}

export interface PlayHistory {
  artistId: string
  artistName: string
  playedAt: string  // ISO timestamp
}
