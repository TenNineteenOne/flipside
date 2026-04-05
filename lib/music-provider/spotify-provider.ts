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
 * - Retries once on 429 (rate-limited), respecting the Retry-After header
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
    const retryAfter = parseInt(res.headers.get("Retry-After") ?? "2", 10)
    await new Promise((resolve) => setTimeout(resolve, retryAfter * 1000))
    return spotifyFetch(url, accessToken, options, true)
  }

  return res
}

// ---------------------------------------------------------------------------
// SpotifyProvider
// ---------------------------------------------------------------------------

export class SpotifyProvider implements MusicProvider {
  private static _lastFmKeyMissing = false

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
  async getSimilarArtists(accessToken: string, artistId: string, artistName: string, genres: string[] = []): Promise<Artist[]> {
    const lastFmArtists = await this._getSimilarViaLastFm(accessToken, artistName)
    const genreArtists = lastFmArtists.length < 5
      ? await this._getSimilarViaGenreSearch(accessToken, genres)
      : []

    // Merge: Last.fm results first, then genre search not already included
    const seen = new Set<string>()
    const merged: Artist[] = []

    for (const a of [...lastFmArtists, ...genreArtists]) {
      if (!seen.has(a.id)) {
        seen.add(a.id)
        merged.push(a)
      }
    }

    return merged
  }

  /** Fetch similar artists from Last.fm and resolve each to a Spotify Artist object. */
  private async _getSimilarViaLastFm(accessToken: string, artistName: string): Promise<Artist[]> {
    const apiKey = process.env.LASTFM_API_KEY
    if (!apiKey) {
      if (!SpotifyProvider._lastFmKeyMissing) {
        console.warn("[spotify] LASTFM_API_KEY not set — Last.fm expansion disabled")
        SpotifyProvider._lastFmKeyMissing = true
      }
      return []
    }

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

      const names = data.similarartists.artist.map((a) => a.name).slice(0, 15)

      // Resolve in batches of 5 to avoid Spotify rate limits
      const resolved: Artist[] = []
      for (let i = 0; i < names.length; i += 5) {
        const batch = names.slice(i, i + 5)
        const settled = await Promise.allSettled(batch.map((n) => this._searchOneArtist(accessToken, n)))
        for (const r of settled) {
          if (r.status === "fulfilled" && r.value) resolved.push(r.value)
        }
      }
      return resolved
    } catch {
      return []
    }
  }

  /** Search Spotify for a single artist by name. Uses the caller's access token. */
  private async _searchOneArtist(accessToken: string, name: string): Promise<Artist | null> {
    const res = await spotifyFetch(
      `${SPOTIFY_BASE}/search?q=${encodeURIComponent(name)}&type=artist&limit=5`,
      accessToken
    )
    if (!res || !res.ok) return null

    const data = (await res.json()) as SpotifySearchResponse
    const items = data.artists?.items ?? []
    if (!items.length) return null

    // Prefer exact name match, then fall back to highest popularity.
    const lower = name.toLowerCase()
    const exact = items.find((a) => a.name.toLowerCase() === lower)
    const best = exact ?? [...items].sort((a, b) => b.popularity - a.popularity)[0]
    return best ? mapArtist(best) : null
  }

  /** Search Spotify for artists by genre when Last.fm returns few results. */
  private async _getSimilarViaGenreSearch(accessToken: string, genres: string[]): Promise<Artist[]> {
    if (!genres.length) return []

    const toSearch = [...new Set(genres)].slice(0, 2)

    const results = await Promise.allSettled(
      toSearch.map(async (genre) => {
        const res = await spotifyFetch(
          `${SPOTIFY_BASE}/search?q=genre:${encodeURIComponent(`"${genre}"`)}&type=artist&limit=10`,
          accessToken
        )
        if (!res || !res.ok) return [] as Artist[]
        const data = (await res.json()) as SpotifySearchResponse
        return (data.artists?.items ?? []).map(mapArtist)
      })
    )

    const artists: Artist[] = []
    const seen = new Set<string>()
    for (const r of results) {
      if (r.status === "fulfilled") {
        for (const a of r.value) {
          if (!seen.has(a.id)) {
            seen.add(a.id)
            artists.push(a)
          }
        }
      }
    }
    return artists
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
    limit: number,
    market = "from_token"
  ): Promise<Track[]> {
    const res = await spotifyFetch(
      `${SPOTIFY_BASE}/artists/${artistId}/top-tracks?market=${market}`,
      accessToken
    )
    if (!res || !res.ok) return []

    const data = (await res.json()) as { tracks: SpotifyTrackObject[] }
    return (data.tracks ?? []).slice(0, limit).map(mapTrack)
  }

  // -------------------------------------------------------------------------
  // getUserMarket
  // -------------------------------------------------------------------------
  async getUserMarket(accessToken: string): Promise<string> {
    try {
      const res = await spotifyFetch(`${SPOTIFY_BASE}/me`, accessToken)
      if (!res || !res.ok) return "US"
      const profile = await res.json() as { country?: string }
      return profile.country ?? "US"
    } catch {
      return "US"
    }
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
