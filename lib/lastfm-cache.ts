import { createServiceClient } from '@/lib/supabase/server'
import type { SimilarArtistRef } from '@/lib/music-provider'

const TTL_MS = 7 * 24 * 60 * 60 * 1000
// Negative-cache TTL for genuinely-empty tag results. Short, so a tag that gains
// artists (or a one-off Last.fm hiccup that still returned a valid empty body)
// is rechecked within the day — but long enough that obscure leaf tags don't
// re-hit Last.fm on every Explore generation, which was the dominant cold-load
// cost. Transient *failures* (timeout / non-2xx) are never cached at all.
const NEG_TTL_MS = 12 * 60 * 60 * 1000

// Within-request memoization. Clears on every server cold start; the Supabase
// table is the durable layer. Guards against duplicate Last.fm fetches inside
// a single request (e.g. both adjacent and leftfield sampling "indie").
const tagInflight = new Map<string, Promise<string[]>>()
const similarInflight = new Map<string, Promise<SimilarArtistRef[]>>()

type Kind = 'tag_top' | 'similar'

interface CacheRow {
  payload: unknown
  fetched_at: string
}

async function readCache(kind: Kind, key: string): Promise<CacheRow | null> {
  try {
    const supabase = createServiceClient()
    const { data, error } = await supabase
      .from('lastfm_cache')
      .select('payload, fetched_at')
      .eq('kind', kind)
      .eq('key', key)
      .maybeSingle()
    if (error || !data) return null
    return data as CacheRow
  } catch {
    return null
  }
}

async function writeCache(kind: Kind, key: string, payload: unknown): Promise<void> {
  try {
    const supabase = createServiceClient()
    await supabase
      .from('lastfm_cache')
      .upsert(
        { kind, key, payload, fetched_at: new Date().toISOString() },
        { onConflict: 'kind,key' },
      )
  } catch {
    // Cache writes are best-effort — failure to persist does not affect the call path.
  }
}

function freshWithin(row: CacheRow, ttlMs: number): boolean {
  const age = Date.now() - new Date(row.fetched_at).getTime()
  return age < ttlMs
}

/**
 * Read-through cache for Last.fm tag.getTopArtists. 7-day TTL shared across
 * users. Returns the fetched names. On fetch failure the miss is NOT cached
 * (empty results would poison other users for a full week).
 */
export async function cachedTagArtistNames(
  tag: string,
  limit: number,
  fetchFn: (tag: string, limit: number) => Promise<string[]>,
): Promise<string[]> {
  const cacheKey = `${tag.toLowerCase()}:${limit}`
  const inflight = tagInflight.get(cacheKey)
  if (inflight) return inflight

  const promise = (async () => {
    const row = await readCache('tag_top', cacheKey)
    if (row && Array.isArray(row.payload)) {
      // Empty (negative) entries expire on the short TTL; populated ones on the
      // full 7-day TTL.
      const ttl = row.payload.length === 0 ? NEG_TTL_MS : TTL_MS
      if (freshWithin(row, ttl)) return row.payload as string[]
    }
    let fresh: string[]
    try {
      fresh = await fetchFn(tag, limit)
    } catch {
      // Transient failure (timeout / non-2xx / network). Do NOT cache — caching
      // an empty here would suppress a live tag for the negative TTL.
      return []
    }
    // Cache both hits and genuine empties (negative caching). Empties carry the
    // shorter TTL via the read path above.
    await writeCache('tag_top', cacheKey, fresh)
    return fresh
  })()

  tagInflight.set(cacheKey, promise)
  try {
    return await promise
  } finally {
    tagInflight.delete(cacheKey)
  }
}

/**
 * Read-through cache for Last.fm artist.getSimilar. 7-day TTL. Preserves the
 * `{ name, match }` shape callers rely on for tail-bias sorting.
 */
export async function cachedSimilarArtistNames(
  artistName: string,
  fetchFn: (artistName: string) => Promise<SimilarArtistRef[]>,
): Promise<SimilarArtistRef[]> {
  const cacheKey = artistName.toLowerCase()
  const inflight = similarInflight.get(cacheKey)
  if (inflight) return inflight

  const promise = (async () => {
    const row = await readCache('similar', cacheKey)
    if (row && freshWithin(row, TTL_MS) && Array.isArray(row.payload)) {
      return row.payload as SimilarArtistRef[]
    }
    const fresh = await fetchFn(artistName)
    if (fresh.length > 0) await writeCache('similar', cacheKey, fresh)
    return fresh
  })()

  similarInflight.set(cacheKey, promise)
  try {
    return await promise
  } finally {
    similarInflight.delete(cacheKey)
  }
}
