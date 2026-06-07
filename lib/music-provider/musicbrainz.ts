/**
 * MusicBrainz Spotify-id resolver (#153).
 *
 * Given an MBID, read the artist's url-rels and extract the Spotify (and Apple /
 * Deezer) ids — the keyless way to recover a Spotify artist id without calling
 * the Spotify API. Used by the Stage-2 backfill worker (#159) to populate the
 * `open in Spotify` link and to resolve seed-selection ids in onboarding (#156).
 *
 * MusicBrainz requires a descriptive User-Agent and rate-limits anonymous
 * clients to ~1 req/s; this module enforces a strict single-process 1-req/s
 * limiter. Relations are matched by URL host (not the `type` field, which varies
 * across "streaming" / "free streaming" / "purchase for download").
 *
 * This module is pure parsing + the limiter + a thin fetch; the worker that
 * drives it over many artists is a separate slice (#159).
 */
const MB_BASE = "https://musicbrainz.org/ws/2"
const USER_AGENT = "Flipside/0.1.0 ( fluxuate27@gmail.com )"
const TIMEOUT_MS = 10_000
const MB_MIN_INTERVAL_MS = 1000

export interface MbExternalIds {
  spotifyId: string | null
  appleId: string | null
  deezerId: string | null
}

interface MbRelation {
  type?: string
  url?: { resource?: string }
}

interface MbArtistResponse {
  relations?: MbRelation[]
  error?: string
}

// ── Pure URL parsers ───────────────────────────────────────────────────────

/** Extract a 22-char Spotify artist id from an open.spotify.com/artist/<id> URL. */
export function parseSpotifyArtistId(url: string): string | null {
  const m = url.match(/open\.spotify\.com\/artist\/([A-Za-z0-9]{22})\b/)
  return m ? m[1] : null
}

/**
 * Extract an Apple Music numeric artist id. Handles the locale segment and an
 * optional name slug: `music.apple.com/gb/artist/657515`,
 * `music.apple.com/us/artist/radiohead/657515`, `.../artist/id657515`.
 */
export function parseAppleArtistId(url: string): string | null {
  const m = url.match(/music\.apple\.com\/(?:[a-z]{2}\/)?artist\/(?:[^/?#]+\/)*(?:id)?(\d+)/)
  return m ? m[1] : null
}

/** Extract a numeric Deezer artist id from a deezer.com/artist/<id> URL. */
export function parseDeezerArtistId(url: string): string | null {
  const m = url.match(/deezer\.com\/(?:[a-z]{2}\/)?artist\/(\d+)/)
  return m ? m[1] : null
}

/**
 * Extract external service ids from a MusicBrainz relations array. Takes the
 * FIRST match for each service (MB can list multiple, e.g. duplicate Deezer
 * rels). Returns nulls for any service with no relation — the caller treats a
 * null Spotify id as "fall back to an open.spotify.com/search link downstream".
 */
export function extractExternalIds(relations: MbRelation[] | undefined | null): MbExternalIds {
  const out: MbExternalIds = { spotifyId: null, appleId: null, deezerId: null }
  if (!Array.isArray(relations)) return out
  for (const r of relations) {
    const url = r?.url?.resource
    if (typeof url !== "string" || url.length === 0) continue
    if (!out.spotifyId) out.spotifyId = parseSpotifyArtistId(url)
    if (!out.appleId) out.appleId = parseAppleArtistId(url)
    if (!out.deezerId) out.deezerId = parseDeezerArtistId(url)
    if (out.spotifyId && out.appleId && out.deezerId) break
  }
  return out
}

// ── Strict 1-req/s limiter (single-process) ──────────────────────────────────

const realSleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

export interface MbLimiterOptions {
  minIntervalMs?: number
  now?: () => number
  sleep?: (ms: number) => Promise<void>
}

export interface MbLimiter {
  run<T>(fn: () => Promise<T>): Promise<T>
}

/**
 * Serialized rate limiter that guarantees at least `minIntervalMs` between call
 * STARTS (default 1000ms = 1 req/s). Clock + sleep are injectable so the rate is
 * unit-tested deterministically. Calls run one-at-a-time in FIFO order.
 */
export function createMbLimiter(opts: MbLimiterOptions = {}): MbLimiter {
  const minInterval = opts.minIntervalMs ?? MB_MIN_INTERVAL_MS
  const now = opts.now ?? Date.now
  const sleep = opts.sleep ?? realSleep
  let chain: Promise<unknown> = Promise.resolve()
  let lastStart = -Infinity

  return {
    run<T>(fn: () => Promise<T>): Promise<T> {
      const result = chain.then(async () => {
        const wait = lastStart + minInterval - now()
        if (wait > 0) await sleep(wait)
        lastStart = now()
        return fn()
      })
      // Keep the chain alive regardless of this call's outcome.
      chain = result.then(
        () => {},
        () => {},
      )
      return result
    },
  }
}

const defaultLimiter = createMbLimiter()

// ── Fetch + resolve ──────────────────────────────────────────────────────────

/**
 * Fetch an artist's url-rels from MusicBrainz. Throws on non-2xx / MB error so
 * the caller can distinguish a transient failure from a genuine "no relations".
 * Not rate-limited itself — callers go through `resolveArtistExternalIds`.
 */
export async function fetchArtistRelations(
  mbid: string,
  fetchImpl: typeof fetch = fetch,
): Promise<MbRelation[]> {
  const url = `${MB_BASE}/artist/${encodeURIComponent(mbid)}?inc=url-rels&fmt=json`
  const res = await fetchImpl(url, {
    headers: { "User-Agent": USER_AGENT },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
  if (!res.ok) throw new Error(`musicbrainz ${res.status}`)
  const data = (await res.json()) as MbArtistResponse
  if (data.error) throw new Error(`musicbrainz error: ${data.error}`)
  return data.relations ?? []
}

/**
 * Resolve an MBID to its external service ids via MusicBrainz url-rels, under
 * the 1-req/s limiter. Returns all-null on a transient failure (caller can
 * retry / fall back). A successful response with no Spotify relation yields
 * `spotifyId: null`.
 */
export async function resolveArtistExternalIds(
  mbid: string,
  opts: { fetchImpl?: typeof fetch; limiter?: MbLimiter } = {},
): Promise<MbExternalIds> {
  const limiter = opts.limiter ?? defaultLimiter
  try {
    const relations = await limiter.run(() => fetchArtistRelations(mbid, opts.fetchImpl ?? fetch))
    return extractExternalIds(relations)
  } catch {
    return { spotifyId: null, appleId: null, deezerId: null }
  }
}
