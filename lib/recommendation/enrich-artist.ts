import type { Artist } from "@/lib/music-provider/types"

export interface ArtistEnrichment {
  genres: string[]
  popularity: number
}

const LASTFM_BASE = "https://ws.audioscrobbler.com/2.0"
const TIMEOUT_MS = 6000
const MAX_GENRES = 5

// Tags Last.fm returns that are not genres. Conservative — only obvious noise.
export const LASTFM_TAG_BLOCKLIST = new Set<string>([
  "seen live", "favorite", "favourite", "favorites", "favourites",
  "favorite artists", "favourite artists", "love at first listen",
  "awesome", "amazing", "beautiful", "check out", "albums i own",
  "female vocalists", "male vocalists", "female vocalist", "male vocalist",
  "spotify", "mp3", "bandcamp", "youtube",
  "my music", "my favorites", "good", "great", "best",
])
export const LASTFM_TAG_ERA_RE = /^(pre-)?\d{2,4}s$/

/**
 * Log-scale Last.fm listener counts into Spotify's 0-100 popularity range.
 * Calibration: 10K listeners ≈ 30, 1M ≈ 60, 100M ≈ 90.
 */
export function scaleListeners(listeners: number): number {
  if (listeners <= 0) return 0
  const scaled = Math.round((Math.log10(listeners + 1) - 2) * 15)
  return Math.min(100, Math.max(0, scaled))
}

export function filterGenreTags(raw: string[]): string[] {
  return raw
    .map((t) => t.toLowerCase().trim())
    .filter((t) => t.length > 0)
    .filter((t) => !LASTFM_TAG_BLOCKLIST.has(t))
    .filter((t) => !LASTFM_TAG_ERA_RE.test(t))
    .slice(0, MAX_GENRES)
}

/**
 * Fetch genre + popularity for an artist via Last.fm artist.getInfo.
 * Pure: the fetch impl is injected so tests can stub it.
 *
 * Returns null on any failure — the resolve pipeline treats this as
 * "unenriched" and continues with whatever Spotify provided.
 */
export async function fetchArtistEnrichment(
  name: string,
  apiKey: string,
  fetchImpl: typeof fetch = fetch
): Promise<ArtistEnrichment | null> {
  if (!apiKey) return null
  try {
    const url = new URL(LASTFM_BASE)
    url.searchParams.set("method", "artist.getInfo")
    url.searchParams.set("artist", name)
    url.searchParams.set("autocorrect", "1")
    url.searchParams.set("api_key", apiKey)
    url.searchParams.set("format", "json")

    const res = await fetchImpl(url.toString(), {
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    if (!res.ok) return null
    const data = (await res.json()) as {
      artist?: {
        stats?: { listeners?: string }
        tags?: { tag?: Array<{ name?: string }> }
      }
      error?: number
    }
    if (data.error || !data.artist) return null

    const listeners = parseInt(data.artist.stats?.listeners ?? "0", 10) || 0
    const rawTags = (data.artist.tags?.tag ?? []).map((t) => t.name ?? "")
    return {
      genres: filterGenreTags(rawTags),
      popularity: scaleListeners(listeners),
    }
  } catch {
    return null
  }
}

/**
 * Merge enrichment data into a Spotify artist record. Non-destructive:
 * only fills fields that Spotify left empty. Preserves Spotify's values
 * if they're already populated (forward-compatible if Spotify ever starts
 * returning real genres on /search).
 */
export function mergeEnrichment(artist: Artist, enrichment: ArtistEnrichment | null): Artist {
  if (!enrichment) return artist
  return {
    ...artist,
    genres: artist.genres.length > 0 ? artist.genres : enrichment.genres,
    popularity: artist.popularity > 0 ? artist.popularity : enrichment.popularity,
  }
}
