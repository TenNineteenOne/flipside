/**
 * The Last.fm adapter (#175 E1) — the ONE module that talks to
 * ws.audioscrobbler.com. It owns the API key lookup, base URL, per-endpoint
 * timeouts, the shared rate/concurrency gate (`./limit`), the `lastfm_cache`
 * read-through (`./cache`) and the per-endpoint live-call counters.
 *
 * Callers (Feed/Explore engines, the identity doorway, onboarding search,
 * history sync) depend on `lastfm` (or a `createLastfm({...})` with fakes in
 * tests) and never build Last.fm URLs themselves.
 *
 * Every request is byte-identical to the pre-#175 fetchers (params, limits,
 * autocorrect, encoding, timeouts). Counters tick once per LIVE request, at
 * dispatch inside the gate; cache hits never reach the network or a counter.
 */
import type { Limiter } from "@/lib/limiter"
import {
  incLastfmGetInfo,
  incLastfmSearch,
  incLastfmSimilar,
  incLastfmTag,
  incLastfmUser,
} from "@/lib/recommendation/api-call-counter"
import {
  cachedArtistEnrichment,
  cachedArtistSearch,
  cachedSimilarArtistNames,
  cachedTagArtistNames,
  type CacheStore,
} from "./cache"
import { runLastfm } from "./limit"
import type { ArtistEnrichment, LastfmArtistCandidate, SimilarArtistRef } from "./types"

export type { ArtistEnrichment, LastfmArtistCandidate, SimilarArtistRef } from "./types"
export type { CacheStore } from "./cache"

const LASTFM_BASE = "https://ws.audioscrobbler.com/2.0"

// tag.gettopartists may fire TWO sequential calls (as-is, then a spaced retry
// on empty), so a high per-call ceiling stacks into a ~16s worst case. Valid
// responses return in <1s; 5s is ample headroom.
const TAG_TIMEOUT_MS = 5000
const SIMILAR_TIMEOUT_MS = 8000
const GETINFO_TIMEOUT_MS = 6000
const SEARCH_TIMEOUT_MS = 8000
const USER_TIMEOUT_MS = 8000

const SEARCH_LIMIT = 10
const MAX_GENRES = 5

// ── Pure translation (Last.fm vocabulary → ours) ────────────────────────────

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

interface RawLastfmArtist {
  name?: string
  mbid?: string
  listeners?: string
  image?: Array<{ "#text"?: string; size?: string }>
}

/** Pick the largest non-empty image URL Last.fm returned, or null. */
function pickImage(images?: Array<{ "#text"?: string; size?: string }>): string | null {
  if (!Array.isArray(images)) return null
  const bySize = (s: string) => images.find((i) => i.size === s)?.["#text"]
  const url =
    bySize("extralarge") ||
    bySize("large") ||
    bySize("medium") ||
    images.map((i) => i["#text"]).find((t) => t && t.length > 0)
  return url && url.length > 0 ? url : null
}

/**
 * Map a raw Last.fm artist.search JSON body to candidates. Tolerates the Last.fm
 * quirk where a single result is an object rather than an array, and missing
 * fields. Returns [] for a no-results / malformed body.
 */
export function mapSearchResponse(data: unknown): LastfmArtistCandidate[] {
  const raw = (data as { results?: { artistmatches?: { artist?: unknown } } })?.results?.artistmatches
    ?.artist
  const arr: RawLastfmArtist[] = Array.isArray(raw)
    ? (raw as RawLastfmArtist[])
    : raw
      ? [raw as RawLastfmArtist]
      : []
  return arr
    .filter((a): a is RawLastfmArtist => typeof a?.name === "string" && a.name.length > 0)
    .map((a) => ({
      name: a.name as string,
      mbid: typeof a.mbid === "string" && a.mbid.length > 0 ? a.mbid : null,
      listeners: Number.parseInt(a.listeners ?? "0", 10) || 0,
      imageUrl: pickImage(a.image),
    }))
}

// ── The adapter ─────────────────────────────────────────────────────────────

export interface Lastfm {
  /** True when an API key is configured (callers that feature-detect enrichment use this). */
  hasKey(): boolean
  /**
   * tag.gettopartists names, rank order, cached (7d; empties 12h). Tries the tag
   * as-is, then retries an empty hyphenated tag with spaces ("dutch-black-metal"
   * → "dutch black metal"). Transient failure → [] (not cached).
   */
  tagTopArtists(tag: string, limit?: number): Promise<string[]>
  /** artist.getSimilar refs (name + match), cached 7d (empties not cached). [] on any failure. */
  similarArtists(artistName: string): Promise<SimilarArtistRef[]>
  /**
   * artist.getInfo → genres + popularity, cached (7d; not-found 12h). null for
   * not-found, a transient failure (not cached) or a missing key (no cache read).
   */
  artistInfo(name: string): Promise<ArtistEnrichment | null>
  /** artist.search candidates, cached (7d; empties 12h). Blank query → []. Transient failure → []. */
  searchArtists(query: string, limit?: number): Promise<LastfmArtistCandidate[]>
  /**
   * Unique artist names from user.getTopArtists + user.getRecentTracks (200 each).
   * Uncached. THROWS on missing key, non-2xx or a Last.fm error body.
   */
  userArtistNames(username: string): Promise<string[]>
}

export interface LastfmDeps {
  /** Read at call time (tests stub the env). Default: process.env.LASTFM_API_KEY. */
  apiKey?: () => string | undefined
  /** Default: the global fetch, resolved at call time (so spies/stubs apply). */
  fetch?: typeof fetch
  /** Default: the process-wide Last.fm gate. */
  limiter?: Limiter
  /** Default: the Supabase `lastfm_cache` table. */
  cache?: CacheStore
}

export function createLastfm(deps: LastfmDeps = {}): Lastfm {
  const apiKey = deps.apiKey ?? (() => process.env.LASTFM_API_KEY)
  const doFetch: typeof fetch = deps.fetch ?? ((input, init) => fetch(input, init))
  const gate = deps.limiter ?? { run: runLastfm }
  const cache = deps.cache
  let keyMissingWarned = false

  /** One live request: gated, counted at dispatch, with its endpoint's timeout. */
  function live(url: string, timeoutMs: number, count: () => void): Promise<Response> {
    return gate.run(() => {
      count()
      return doFetch(url, { signal: AbortSignal.timeout(timeoutMs) })
    })
  }

  // Throws on transient failure (non-2xx / timeout / network) so the cache
  // layer can tell "genuinely empty" (negative-cacheable) from "failed".
  async function tagOnce(tag: string, limit: number, key: string): Promise<string[]> {
    const url =
      `${LASTFM_BASE}/?method=tag.gettopartists` +
      `&tag=${encodeURIComponent(tag)}&api_key=${key}&format=json&limit=${limit}`
    const res = await live(url, TAG_TIMEOUT_MS, incLastfmTag)
    if (!res.ok) throw new Error(`lastfm tag.gettopartists ${res.status}`)
    const data = await res.json()
    const artists = data?.topartists?.artist
    if (!Array.isArray(artists)) return []
    return (artists as Array<{ name: string }>).map((a) => a.name).filter(Boolean)
  }

  // Genre-tree leaf tags are hyphenated slugs but Last.fm indexes most
  // multi-word tags space-separated. As-is FIRST so canonical hyphenated tags
  // (trip-hop, post-punk) keep their better-curated results.
  async function tagWithRetry(tag: string, limit: number): Promise<string[]> {
    const key = apiKey()
    if (!key) return []
    const names = await tagOnce(tag, limit, key)
    if (names.length > 0 || !tag.includes("-")) return names
    try {
      return await tagOnce(tag.replace(/-/g, " "), limit, key)
    } catch {
      return names // primary spelling was genuinely empty; don't let a retry blip mask that
    }
  }

  async function similarRaw(artistName: string): Promise<SimilarArtistRef[]> {
    const key = apiKey()
    if (!key) {
      if (!keyMissingWarned) {
        console.warn("[lfm] LASTFM_API_KEY not set")
        keyMissingWarned = true
      }
      return []
    }
    try {
      const url =
        `${LASTFM_BASE}/?method=artist.getSimilar` +
        `&artist=${encodeURIComponent(artistName)}` +
        `&api_key=${key}` +
        `&format=json` +
        `&limit=50`
      const res = await live(url, SIMILAR_TIMEOUT_MS, incLastfmSimilar)
      if (!res.ok) { console.log(`[lfm] ${res.status} artist="${artistName}"`); return [] }

      const data = (await res.json()) as {
        similarartists?: { artist: Array<{ name: string; match?: string | number }> }
        error?: number
      }
      if (data.error || !data.similarartists?.artist?.length) return []

      return data.similarartists.artist
        .map((a) => {
          const rawMatch = typeof a.match === "string" ? parseFloat(a.match) : a.match
          const match = typeof rawMatch === "number" && Number.isFinite(rawMatch) ? rawMatch : 0
          return { name: a.name, match }
        })
        .filter((a) => a.name)
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        console.error(`[lfm] getSimilarArtistNames timed out after 8s artist="${artistName}"`)
      } else {
        console.log(`[lfm] fail artist="${artistName}" err=${err instanceof Error ? err.message : err}`)
      }
      return []
    }
  }

  // THROWS on transient failure (non-2xx, network, non-6 Last.fm error) so it
  // is never cached; null ONLY for a genuine not-found (error 6 / no artist).
  async function infoRaw(name: string, key: string): Promise<ArtistEnrichment | null> {
    const url = new URL(LASTFM_BASE)
    url.searchParams.set("method", "artist.getInfo")
    url.searchParams.set("artist", name)
    url.searchParams.set("autocorrect", "1")
    url.searchParams.set("api_key", key)
    url.searchParams.set("format", "json")

    const res = await live(url.toString(), GETINFO_TIMEOUT_MS, incLastfmGetInfo)
    if (!res.ok) throw new Error(`lastfm getInfo ${res.status}`)

    const data = (await res.json()) as {
      artist?: {
        stats?: { listeners?: string }
        tags?: { tag?: Array<{ name?: string }> }
      }
      error?: number
    }
    if (data.error) {
      if (data.error === 6) return null // Genuine "artist not found" — negative-cacheable.
      throw new Error(`lastfm getInfo error ${data.error}`) // Transient/service error — do not cache.
    }
    if (!data.artist) return null

    const listeners = parseInt(data.artist.stats?.listeners ?? "0", 10) || 0
    const rawTags = (data.artist.tags?.tag ?? []).map((t) => t.name ?? "")
    return { genres: filterGenreTags(rawTags), popularity: scaleListeners(listeners) }
  }

  // Throws on transient failure so it isn't cached.
  async function searchRaw(query: string, limit: number): Promise<LastfmArtistCandidate[]> {
    const key = apiKey()
    if (!key) return []
    const url =
      `${LASTFM_BASE}/?method=artist.search&artist=${encodeURIComponent(query)}` +
      `&api_key=${key}&format=json&limit=${limit}`
    const res = await live(url, SEARCH_TIMEOUT_MS, incLastfmSearch)
    if (!res.ok) throw new Error(`lastfm artist.search ${res.status}`)
    const data = (await res.json()) as { error?: number }
    if (data.error) throw new Error(`lastfm artist.search error ${data.error}`)
    return mapSearchResponse(data)
  }

  return {
    hasKey: () => !!apiKey(),

    tagTopArtists: (tag, limit = 20) => cachedTagArtistNames(tag, limit, tagWithRetry, cache),

    similarArtists: (artistName) => cachedSimilarArtistNames(artistName, similarRaw, cache),

    artistInfo: async (name) => {
      const key = apiKey()
      if (!key) return null
      return cachedArtistEnrichment(name, () => infoRaw(name, key), cache)
    },

    searchArtists: async (query, limit = SEARCH_LIMIT) => {
      const q = query.trim()
      if (q.length === 0) return []
      return cachedArtistSearch<LastfmArtistCandidate>(q, limit, searchRaw, cache)
    },

    userArtistNames: async (username) => {
      const key = apiKey()
      if (!key) throw new Error("Last.fm API key is not configured")
      const base = "https://ws.audioscrobbler.com/2.0/"
      const user = encodeURIComponent(username)
      const [topRes, recentRes] = await Promise.all([
        live(`${base}?method=user.getTopArtists&user=${user}&api_key=${key}&format=json&limit=200`, USER_TIMEOUT_MS, incLastfmUser),
        live(`${base}?method=user.getRecentTracks&user=${user}&api_key=${key}&format=json&limit=200`, USER_TIMEOUT_MS, incLastfmUser),
      ])
      if (!topRes.ok) throw new Error(`Failed to fetch Last.fm top artists (HTTP ${topRes.status})`)
      if (!recentRes.ok) throw new Error(`Failed to fetch Last.fm recent tracks (HTTP ${recentRes.status})`)

      const top = (await topRes.json()) as {
        topartists?: { artist: Array<{ name: string }> }
        error?: number
        message?: string
      }
      const recent = (await recentRes.json()) as {
        recenttracks?: { track: { artist: { "#text": string } } | Array<{ artist: { "#text": string } }> }
        error?: number
        message?: string
      }
      if (top.error) {
        throw new Error(top.message ?? `Last.fm error ${top.error}: could not load top artists for "${username}"`)
      }
      if (recent.error) {
        throw new Error(recent.message ?? `Last.fm error ${recent.error}: could not load recent tracks for "${username}"`)
      }

      const names = new Set<string>()
      for (const a of top.topartists?.artist ?? []) if (a.name) names.add(a.name)
      const raw = recent.recenttracks?.track ?? []
      for (const t of Array.isArray(raw) ? raw : [raw]) {
        const name = t.artist?.["#text"]
        if (name) names.add(name)
      }
      return [...names]
    },
  }
}

/** The production adapter (env key, global fetch, shared gate, Supabase cache). */
export const lastfm: Lastfm = createLastfm()
