/**
 * The Spotify Web API adapter — client-credentials only since the user-token
 * surface was removed (#175; restore tag `archive/spotify-user-token`). Two
 * live calls remain:
 *
 *  - `getSpotifyTopTracks` — the preview fallback after iTunes (generation).
 *  - `searchSpotifyArtists` — name → Spotify id + image; used only by
 *    `scripts/seed-artist-cache.ts` (generation resolves names via Last.fm).
 *
 * Similarity is NOT here: that is Last.fm (`@/lib/lastfm`).
 */
import type { RateLimited } from "./index"
import type { Artist, Track } from "./types"
import { incSpotify } from "@/lib/recommendation/api-call-counter"
import { PreviewSourceBreaker } from "@/lib/preview-source-breaker"

/**
 * Process-global Spotify circuit breaker (issue #142).
 *
 * Primary purpose: when Spotify returns a 429 with an explicit Retry-After
 * header (sometimes 24 h for credential-level bans), we call openUntil() so
 * subsequent calls short-circuit without re-hammering the API.
 *
 * Also trips on consecutive non-429 failures (5xx etc.) for 60 s.
 * Short-circuited calls are NOT counted against the #141 API-call counters.
 */
const spotifyBreaker = new PreviewSourceBreaker({
  failureThreshold: 5,
  cooldownMs: 60_000,
})

const SPOTIFY_BASE = "https://api.spotify.com/v1"

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
    spotifyTrackId: t.id,
    name: t.name,
    previewUrl: t.preview_url,
    durationMs: t.duration_ms,
    albumName: t.album.name,
    albumImageUrl: t.album.images?.[0]?.url ?? null,
    source: 'spotify',
  }
}

/**
 * Thin wrapper around fetch that:
 * - Sets the Spotify Bearer auth header
 * - Returns null for 401 (token expired — let the auth layer handle refresh)
 * - Retries once on 429 (rate-limited), respecting the Retry-After header
 */
async function spotifyFetch(url: string, accessToken: string): Promise<Response | null> {
  let res: Response
  try {
    res = await fetch(url, {
      signal: AbortSignal.timeout(8000),
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
    })
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      console.error(`[spotify] fetch timed out after 8s url=${url}`)
    } else {
      console.error(`[spotify] fetch failed url=${url} err=${err instanceof Error ? err.message : err}`)
    }
    return null
  }

  if (res.status === 401) {
    return null
  }

  // Don't retry on 429 — callers handle non-OK responses gracefully.
  // Retrying with Spotify's Retry-After (often 30-60s) causes function timeouts.

  return res
}

// ---------------------------------------------------------------------------
// Operations
// ---------------------------------------------------------------------------

/**
 * Search artists by name. Returns a `RateLimited` sentinel with the
 * `Retry-After` value (seconds) on 429, or `skipRetry` while the breaker is open.
 */
export async function searchSpotifyArtists(accessToken: string, query: string): Promise<Artist[] | RateLimited> {
  // Short-circuit while the breaker is open — no fetch, no counter increment.
  if (!spotifyBreaker.canRequest()) {
    const remainingSec = Math.ceil(spotifyBreaker.remainingMs() / 1000)
    console.log(`[s429] "${query}" breaker open, skipping (${remainingSec}s remaining)`)
    return { rateLimited: true, retryAfterSec: remainingSec, skipRetry: true }
  }

  incSpotify()
  const res = await spotifyFetch(
    `${SPOTIFY_BASE}/search?q=${encodeURIComponent(query)}&type=artist&limit=10`,
    accessToken
  )
  if (!res) {
    console.log(`[s401] "${query}"`)
    return []
  }
  if (res.status === 429) {
    const raw = res.headers.get('retry-after')
    const parsed = raw ? parseInt(raw, 10) : NaN
    const retryAfterSec = Number.isFinite(parsed) && parsed > 0 ? parsed : 10
    console.log(`[s429] "${query}" retry-after=${retryAfterSec}s`)
    // Honor the provider's retry-after: block all subsequent calls until it expires.
    spotifyBreaker.openUntil(Date.now() + retryAfterSec * 1000)
    spotifyBreaker.recordFailure()
    return { rateLimited: true, retryAfterSec }
  }
  if (!res.ok) {
    spotifyBreaker.recordFailure()
    console.log(`[s${res.status}] "${query}"`)
    return []
  }

  spotifyBreaker.recordSuccess()
  const data = (await res.json()) as SpotifySearchResponse
  return (data.artists?.items ?? []).map(mapArtist)
}

/** Top tracks for a Spotify artist id (up to `limit`). Throws 'auth_expired' | 'http_N'. */
export async function getSpotifyTopTracks(
  accessToken: string,
  artistId: string,
  limit: number,
  market = "from_token",
): Promise<Track[]> {
  // Short-circuit while the breaker is open — return empty, no counter increment.
  if (!spotifyBreaker.canRequest()) {
    console.log(`[spotify] breaker open, skip getArtistTopTracks artistId="${artistId}"`)
    return []
  }

  incSpotify()
  const res = await spotifyFetch(
    `${SPOTIFY_BASE}/artists/${artistId}/top-tracks?market=${market}`,
    accessToken
  )
  if (!res) throw new Error('auth_expired')
  if (!res.ok) {
    if (res.status === 429) {
      const raw = res.headers.get('retry-after')
      const parsed = raw ? parseInt(raw, 10) : NaN
      const retryAfterSec = Number.isFinite(parsed) && parsed > 0 ? parsed : 10
      spotifyBreaker.openUntil(Date.now() + retryAfterSec * 1000)
    }
    spotifyBreaker.recordFailure()
    throw new Error(`http_${res.status}`)
  }

  spotifyBreaker.recordSuccess()
  const data = (await res.json()) as { tracks: SpotifyTrackObject[] }
  return (data.tracks ?? []).slice(0, limit).map(mapTrack)
}
