import type { ArtistWithTracks } from '../music-provider/types'

export interface RecommendationInput {
  userId: string        // Supabase UUID
  accessToken: string   // Spotify access token (empty string if user has no Spotify)
  playThreshold: number // from users.play_threshold
  genre?: string        // optional genre filter for targeted generation
  undergroundMode?: boolean // when true, applies additional discoveryScore penalty
}

export interface ScoredArtist {
  artist: ArtistWithTracks
  score: number
  why: { sourceArtists: string[]; genres: string[]; friendBoost: string[] }
  source: string
}
