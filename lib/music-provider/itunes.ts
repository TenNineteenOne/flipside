import type { Track } from "./types"
import { runItunes } from "@/lib/itunes-limit"
import { incItunes } from "@/lib/recommendation/api-call-counter"
import { PreviewSourceBreaker } from "@/lib/preview-source-breaker"

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
 * Process-global iTunes circuit breaker (issue #142).
 * Trips open after 5 consecutive HTTP errors or network failures and stays
 * open for 60 seconds before allowing a half-open probe.
 * Short-circuited calls are NOT counted against the #141 API-call counters.
 */
const itunesBreaker = new PreviewSourceBreaker({
  failureThreshold: 5,
  cooldownMs: 60_000,
})

/**
 * Search iTunes for top tracks by an artist name. Free, no auth, no key.
 * Filters results to tracks whose artistName matches case-insensitively and
 * de-dupes by track name (iTunes often returns album + single versions).
 *
 * Returns `null` on network / parse failure or when the circuit breaker is
 * open so the caller can fall back.
 */
export async function searchTracksByArtist(
  artistName: string,
  market = "US",
  limit = 5
): Promise<Track[] | null> {
  // Short-circuit while the breaker is open — no fetch, no counter increment.
  if (!itunesBreaker.canRequest()) {
    console.log(`[itunes] breaker open, skip artist="${artistName}"`)
    return null
  }

  let items: ITunesResult[]
  try {
    const url =
      `${ITUNES_BASE}?term=${encodeURIComponent(artistName)}` +
      `&entity=song&limit=25&country=${encodeURIComponent(market)}`
    items = await runItunes(async () => {
      incItunes()
      const res = await fetch(url, { signal: AbortSignal.timeout(8000) })
      if (!res.ok) {
        console.log(`[itunes] ${res.status} artist="${artistName}"`)
        if (res.status === 403 || res.status === 429) {
          itunesBreaker.recordFailure()
        }
        throw new Error(`itunes ${res.status}`)
      }
      itunesBreaker.recordSuccess()
      const data = (await res.json()) as ITunesResponse
      return data.results ?? []
    })
  } catch (err) {
    // Network timeout or other throw (not an HTTP error we already handled above)
    const msg = err instanceof Error ? err.message : String(err)
    if (!msg.startsWith("itunes ")) {
      // Non-HTTP throw (e.g. AbortError timeout) — record as unhealthy signal
      itunesBreaker.recordFailure()
    }
    console.log(`[itunes] fail artist="${artistName}" err=${msg}`)
    return null
  }

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
}

/** iTunes artwork URLs are fixed-size; swap 100x100 → 600x600 for HiDPI. */
function upscaleArtwork(url: string | null): string | null {
  if (!url) return null
  return url.replace(/\/\d+x\d+bb\.(jpg|png)$/, "/600x600bb.$1")
}
