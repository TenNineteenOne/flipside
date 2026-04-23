import { createServiceClient } from '@/lib/supabase/server'
import type { SimilarArtistRef } from '@/lib/music-provider'

const TTL_MS = 7 * 24 * 60 * 60 * 1000

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

function isFresh(row: CacheRow): boolean {
  const age = Date.now() - new Date(row.fetched_at).getTime()
  return age < TTL_MS
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
    if (row && isFresh(row) && Array.isArray(row.payload)) {
      return row.payload as string[]
    }
    const fresh = await fetchFn(tag, limit)
    if (fresh.length > 0) await writeCache('tag_top', cacheKey, fresh)
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
    if (row && isFresh(row) && Array.isArray(row.payload)) {
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
