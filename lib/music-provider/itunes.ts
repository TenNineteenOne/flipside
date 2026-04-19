import type { Track } from "./types"

const ITUNES_BASE = "https://itunes.apple.com/search"

interface ITunesResult {
  trackId: number
  trackName: string
  artistName: string
  collectionName: string
  artworkUrl100: string | null
  previewUrl: string | null
  trackTimeMillis: number
}

interface ITunesResponse {
  resultCount: number
  results: ITunesResult[]
}

/**
 * Search iTunes for top tracks by an artist name. Free, no auth, no key.
 * Filters results to tracks whose artistName matches case-insensitively and
 * de-dupes by track name (iTunes often returns album + single versions).
 *
 * Returns `null` on network / parse failure so the caller can fall back.
 */
export async function searchTracksByArtist(
  artistName: string,
  market = "US",
  limit = 5
): Promise<Track[] | null> {
  try {
    const url =
      `${ITUNES_BASE}?term=${encodeURIComponent(artistName)}` +
      `&entity=song&limit=25&country=${encodeURIComponent(market)}`
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) })
    if (!res.ok) {
      console.log(`[itunes] ${res.status} artist="${artistName}"`)
      return null
    }
    const data = (await res.json()) as ITunesResponse
    const items = data.results ?? []
    const target = artistName.toLowerCase().trim()

    const seen = new Set<string>()
    const out: Track[] = []
    for (const it of items) {
      if (!it?.trackName || !it?.artistName) continue
      if (it.artistName.toLowerCase().trim() !== target) continue
      const key = it.trackName.toLowerCase().trim()
      if (seen.has(key)) continue
      seen.add(key)
      out.push({
        id: String(it.trackId),
        spotifyTrackId: null,
        name: it.trackName,
        previewUrl: it.previewUrl ?? null,
        durationMs: it.trackTimeMillis ?? 0,
        albumName: it.collectionName ?? "",
        albumImageUrl: upscaleArtwork(it.artworkUrl100),
        source: "itunes",
      })
      if (out.length >= limit) break
    }
    return out
  } catch (err) {
    console.log(`[itunes] fail artist="${artistName}" err=${err instanceof Error ? err.message : String(err)}`)
    return null
  }
}

/** iTunes artwork URLs are fixed-size; swap 100x100 → 600x600 for HiDPI. */
function upscaleArtwork(url: string | null): string | null {
  if (!url) return null
  return url.replace(/\/\d+x\d+bb\.(jpg|png)$/, "/600x600bb.$1")
}
