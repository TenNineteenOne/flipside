import type { MusicProvider } from "./index"
import type { Artist, PlayHistory, Track } from "./types"

const SPOTIFY_BASE = "https://api.spotify.com/v1"
const LASTFM_BASE = "http://ws.audioscrobbler.com/2.0"

// ---------------------------------------------------------------------------
// Internal Spotify API response shapes
// ---------------------------------------------------------------------------

interface SpotifyImage {
  url: string
  height: number | null
  width: number | null
}

interface SpotifyArtistObject {
  id: string
  name: string
  genres: string[]
  images: SpotifyImage[]
  popularity: number
}

interface SpotifyTrackObject {
  id: string
  name: string
  preview_url: string | null
  duration_ms: number
  album: {
    name: string
    images: SpotifyImage[]
  }
}

interface SpotifyRecommendationsResponse {
  tracks: Array<SpotifyTrackObject & { artists: SpotifyArtistObject[] }>
}

interface SpotifySearchResponse {
  artists: {
    items: SpotifyArtistObject[]
  }
}

interface SpotifyRecentlyPlayedResponse {
  items: Array<{
    track: {
      artists: Array<{ id: string; name: string }>
    }
    played_at: string
  }>
}

interface LastFmSimilarArtistsResponse {
  similarartists?: {
    artist: Array<{ name: string }>
  }
  error?: number
  message?: string
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mapArtist(a: SpotifyArtistObject): Artist {
  return {
    id: a.id,
    name: a.name,
    genres: a.genres ?? [],
    imageUrl: a.images?.[0]?.url ?? null,
    popularity: a.popularity ?? 0,
  }
}

function mapTrack(t: SpotifyTrackObject): Track {
  return {
    id: t.id,
    name: t.name,
    previewUrl: t.preview_url,
    durationMs: t.duration_ms,
    albumName: t.album.name,
    albumImageUrl: t.album.images?.[0]?.url ?? null,
  }
}

/**
 * Thin wrapper around fetch that:
 * - Sets the Spotify Bearer auth header
 * - Returns null for 401 (token expired — let the auth layer handle refresh)
 * - Retries once after 1 second on 429 (rate-limited)
 */
async function spotifyFetch(
  url: string,
  accessToken: string,
  options: RequestInit = {},
  isRetry = false
): Promise<Response | null> {
  const res = await fetch(url, {
    ...options,
    headers: {
      "Authorization": `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      ...(options.headers ? (options.headers as Record<string, string>) : {}),
    },
  })

  if (res.status === 401) {
    return null
  }

  if (res.status === 429 && !isRetry) {
    await new Promise((resolve) => setTimeout(resolve, 1000))
    return spotifyFetch(url, accessToken, options, true)
  }

  return res
}

// ---------------------------------------------------------------------------
// SpotifyProvider
// ---------------------------------------------------------------------------

export class SpotifyProvider implements MusicProvider {
  // -------------------------------------------------------------------------
  // getTopArtists
  // -------------------------------------------------------------------------
  async getTopArtists(
    accessToken: string,
    term: "short_term" | "medium_term" | "long_term"
  ): Promise<Artist[]> {
    const res = await spotifyFetch(
      `${SPOTIFY_BASE}/me/top/artists?limit=50&time_range=${term}`,
      accessToken
    )
    if (!res || !res.ok) return []

    const data = (await res.json()) as { items: SpotifyArtistObject[] }
    return (data.items ?? []).map(mapArtist)
  }

  // -------------------------------------------------------------------------
  // getSimilarArtists
  // -------------------------------------------------------------------------
  async getSimilarArtists(artistId: string, artistName: string): Promise<Artist[]> {
    const lastFmArtists = await this._getSimilarViaLastFm(artistName)
    const spotifyRecArtists = await this._getSimilarViaSpotifyRecs(artistId)

    // Merge: Last.fm results first, then Spotify recs not already included
    const seen = new Set<string>()
    const merged: Artist[] = []

    for (const a of [...lastFmArtists, ...spotifyRecArtists]) {
      if (!seen.has(a.id)) {
        seen.add(a.id)
        merged.push(a)
      }
    }

    return merged
  }

  /** Fetch similar artists from Last.fm and resolve each to a Spotify Artist object. */
  private async _getSimilarViaLastFm(artistName: string): Promise<Artist[]> {
    const apiKey = process.env.LASTFM_API_KEY
    if (!apiKey) return []

    try {
      const url =
        `${LASTFM_BASE}/?method=artist.getSimilar` +
        `&artist=${encodeURIComponent(artistName)}` +
        `&api_key=${apiKey}` +
        `&format=json` +
        `&limit=30`

      const res = await fetch(url)
      if (!res.ok) return []

      const data = (await res.json()) as LastFmSimilarArtistsResponse
      if (data.error || !data.similarartists?.artist?.length) return []

      const names = data.similarartists.artist.map((a) => a.name)

      // Resolve each name to a Spotify Artist in parallel (best-effort)
      const settled = await Promise.allSettled(
        names.map((name) => this._searchOneArtist(name))
      )

      return settled
        .filter(
          (r): r is PromiseFulfilledResult<Artist | null> => r.status === "fulfilled"
        )
        .map((r) => r.value)
        .filter((a): a is Artist => a !== null)
    } catch {
      // Network error or bad API key — fall through to Spotify recs
      return []
    }
  }

  /**
   * Search Spotify for a single artist by name. Returns null if not found.
   * Note: this method does NOT need an access token because it is only called
   * from getSimilarArtists which is an unauthenticated flow — we use a
   * server-side token if needed, but the spec says getSimilarArtists has no
   * accessToken parameter. For Spotify search we need a token; we resolve this
   * by accepting that Spotify search calls here will be made without a user
   * token — in practice this method is called from internal flows where a
   * server-side Client Credentials token should be available via env, but the
   * MusicProvider interface does not expose that complexity. We skip resolution
   * gracefully if no token is available.
   *
   * To keep things simple and aligned with the interface spec we accept that
   * Last.fm artists without a discoverable Spotify match are silently dropped.
   */
  private async _searchOneArtist(name: string): Promise<Artist | null> {
    // We need an access token for Spotify search. Since getSimilarArtists does
    // not receive one, we check for a server-side client credentials token in
    // the environment. If unavailable we skip this artist.
    const serverToken = process.env.SPOTIFY_SERVER_TOKEN
    if (!serverToken) return null

    const res = await spotifyFetch(
      `${SPOTIFY_BASE}/search?q=${encodeURIComponent(name)}&type=artist&limit=1`,
      serverToken
    )
    if (!res || !res.ok) return null

    const data = (await res.json()) as SpotifySearchResponse
    const item = data.artists?.items?.[0]
    return item ? mapArtist(item) : null
  }

  /** Fetch similar artists from Spotify Recommendations (seed by artist). */
  private async _getSimilarViaSpotifyRecs(artistId: string): Promise<Artist[]> {
    const serverToken = process.env.SPOTIFY_SERVER_TOKEN
    if (!serverToken) return []

    const res = await spotifyFetch(
      `${SPOTIFY_BASE}/recommendations?seed_artists=${artistId}&limit=20`,
      serverToken
    )
    if (!res || !res.ok) return []

    const data = (await res.json()) as SpotifyRecommendationsResponse
    const artistMap = new Map<string, Artist>()

    for (const track of data.tracks ?? []) {
      for (const a of track.artists ?? []) {
        if (!artistMap.has(a.id)) {
          artistMap.set(a.id, mapArtist(a))
        }
      }
    }

    return Array.from(artistMap.values())
  }

  // -------------------------------------------------------------------------
  // getRecentlyPlayed
  // -------------------------------------------------------------------------
  async getRecentlyPlayed(accessToken: string): Promise<PlayHistory[]> {
    const res = await spotifyFetch(
      `${SPOTIFY_BASE}/me/player/recently-played?limit=50`,
      accessToken
    )
    if (!res || !res.ok) return []

    const data = (await res.json()) as SpotifyRecentlyPlayedResponse
    const seen = new Set<string>()
    const history: PlayHistory[] = []

    for (const item of data.items ?? []) {
      const artist = item.track?.artists?.[0]
      if (!artist) continue
      if (seen.has(artist.id)) continue
      seen.add(artist.id)
      history.push({
        artistId: artist.id,
        artistName: artist.name,
        playedAt: item.played_at,
      })
    }

    return history
  }

  // -------------------------------------------------------------------------
  // searchArtists
  // -------------------------------------------------------------------------
  async searchArtists(accessToken: string, query: string): Promise<Artist[]> {
    const res = await spotifyFetch(
      `${SPOTIFY_BASE}/search?q=${encodeURIComponent(query)}&type=artist&limit=10`,
      accessToken
    )
    if (!res || !res.ok) return []

    const data = (await res.json()) as SpotifySearchResponse
    return (data.artists?.items ?? []).map(mapArtist)
  }

  // -------------------------------------------------------------------------
  // getArtistTopTracks
  // -------------------------------------------------------------------------
  async getArtistTopTracks(
    accessToken: string,
    artistId: string,
    limit: number
  ): Promise<Track[]> {
    const res = await spotifyFetch(
      `${SPOTIFY_BASE}/artists/${artistId}/top-tracks?market=US`,
      accessToken
    )
    if (!res || !res.ok) return []

    const data = (await res.json()) as { tracks: SpotifyTrackObject[] }
    return (data.tracks ?? []).slice(0, limit).map(mapTrack)
  }

  // -------------------------------------------------------------------------
  // createPlaylist
  // -------------------------------------------------------------------------
  async createPlaylist(
    accessToken: string,
    userId: string,
    name: string
  ): Promise<string> {
    const res = await spotifyFetch(
      `${SPOTIFY_BASE}/users/${userId}/playlists`,
      accessToken,
      {
        method: "POST",
        body: JSON.stringify({ name, public: false }),
      }
    )
    if (!res || !res.ok) throw new Error("Failed to create playlist")

    const data = (await res.json()) as { id: string }
    return data.id
  }

  // -------------------------------------------------------------------------
  // addTracksToPlaylist
  // -------------------------------------------------------------------------
  async addTracksToPlaylist(
    accessToken: string,
    playlistId: string,
    trackUris: string[]
  ): Promise<void> {
    const uris = trackUris.map((id) => `spotify:track:${id}`)

    const res = await spotifyFetch(
      `${SPOTIFY_BASE}/playlists/${playlistId}/tracks`,
      accessToken,
      {
        method: "POST",
        body: JSON.stringify({ uris }),
      }
    )
    if (!res || !res.ok) throw new Error("Failed to add tracks to playlist")
  }
}
