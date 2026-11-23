import type { Track } from "./types"
import { runItunes } from "@/lib/itunes-limit"
import { incItunes } from "@/lib/metrics/api-call-counter"
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

export type ItunesFetchResult<T> =
  | { ok: true; data: T }
  /** breaker: skipped, no request made. http: non-2xx. network: fetch threw. parse: bad JSON. */
  | { ok: false; reason: "breaker" | "http" | "network" | "parse"; status?: number; error?: unknown }

/**
 * The ONE outbound iTunes entry point. Every iTunes HTTP call goes through it
 * so all of them share: the circuit breaker (short-circuits while open — no
 * fetch, no counter increment), the process-wide concurrency/min-interval gate
 * (`runItunes`), and the #141 call counter. Never throws.
 *
 * Breaker bookkeeping: 2xx records success; 403/429 and network/parse failures
 * record failure; other HTTP errors (e.g. 404/500) are neutral.
 *
 * `gateOnly: true` (the /api/open link resolver) keeps the concurrency gate but
 * bypasses the preview breaker and the call counter — user link clicks must
 * not trip the breaker that blanks previews, nor inflate `[gen-timing]`
 * counters, and an open breaker must not stop a link lookup (baseline parity).
 */
export async function itunesFetch<T>(
  url: string,
  timeoutMs = 8000,
  { gateOnly = false }: { gateOnly?: boolean } = {},
): Promise<ItunesFetchResult<T>> {
  const breaker = gateOnly ? null : itunesBreaker
  if (breaker && !breaker.canRequest()) return { ok: false, reason: "breaker" }
  return runItunes(async (): Promise<ItunesFetchResult<T>> => {
    if (!gateOnly) incItunes()
    let res: Response
    try {
      res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) })
    } catch (error) {
      breaker?.recordFailure()
      return { ok: false, reason: "network", error }
    }
    if (!res.ok) {
      if (res.status === 403 || res.status === 429) breaker?.recordFailure()
      return { ok: false, reason: "http", status: res.status }
    }
    breaker?.recordSuccess()
    try {
      return { ok: true, data: (await res.json()) as T }
    } catch (error) {
      breaker?.recordFailure()
      return { ok: false, reason: "parse", error }
    }
  })
}

/**
 * Search iTunes for top tracks by an artist name. Free, no auth, no key.
 * Filters results to tracks whose artistName matches case-insensitively (NFC-normalised) and
 * de-dupes by track name (iTunes often returns album + single versions).
 *
 * Returns `null` on network / parse failure or when the circuit breaker is
 * open so the caller can fall back. `null` always means a source failure.
 */
export async function searchTracksByArtist(
  artistName: string,
  market = "US",
  limit = 5
): Promise<Track[] | null> {
  const base =
    `${ITUNES_BASE}?term=${encodeURIComponent(artistName)}` +
    `&entity=song&country=${encodeURIComponent(market)}`
  const first = await searchOnce(`${base}&limit=25`, artistName, limit)
  if (!first || first.tracks.length > 0 || first.total === 0) return first && first.tracks
  // Common-word names (Low, Air, Cake): the top 25 are songs titled that, so ask by artist.
  // shortcut: single-word names only (a no-match is the normal answer for an artist iTunes lacks, and
  // Apple rate-limits per IP), so multi-word common-phrase names are not retried; widen if those go missing.
  if (/\s/.test(artistName.trim())) return first.tracks
  const retry = await searchOnce(`${base}&limit=200&attribute=artistTerm`, artistName, limit)
  return retry && retry.tracks
}

/** One search request: `total` raw results, `tracks` those by exactly this artist. Null on failure. */
async function searchOnce(
  url: string,
  artistName: string,
  limit: number
): Promise<{ total: number; tracks: Track[] } | null> {
  const r = await itunesFetch<ITunesResponse>(url)
  if (!r.ok) {
    if (r.reason === "breaker") {
      console.log(`[itunes] breaker open, skip artist="${artistName}"`)
    } else if (r.reason === "http") {
      console.log(`[itunes] ${r.status} artist="${artistName}"`)
      console.log(`[itunes] fail artist="${artistName}" err=itunes ${r.status}`)
    } else {
      const msg = r.error instanceof Error ? r.error.message : String(r.error)
      console.log(`[itunes] fail artist="${artistName}" err=${msg}`)
    }
    return null
  }
  if (!r.data || typeof r.data !== "object") {
    console.log(`[itunes] fail artist="${artistName}" err=bad payload`)
    return null
  }
  const items: ITunesResult[] = r.data.results ?? []

  // NFC both sides: Last.fm can hand over a decomposed "Sigur Rós" that equals none of iTunes's composed ones.
  const fold = (s: string) => s.normalize("NFC").toLowerCase().trim()
  const target = fold(artistName)
  const seen = new Set<string>()
  const out: Track[] = []
  for (const it of items) {
    if (!it?.trackName || !it?.artistName) continue
    if (fold(it.artistName) !== target) continue
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
  return { total: items.length, tracks: out }
}

/** iTunes artwork URLs are fixed-size; swap 100x100 → 600x600 for HiDPI. */
function upscaleArtwork(url: string | null): string | null {
  if (!url) return null
  return url.replace(/\/\d+x\d+bb\.(jpg|png)$/, "/600x600bb.$1")
}
