import type { Artist } from "@/lib/music-provider/types"

/**
 * Minimal Supabase-client surface area used by ArtistNameCache.
 * Defined locally so tests can pass an in-memory fake without importing
 * the real Supabase SDK.
 */
export interface CacheSupabaseClient {
  from(table: string): {
    select(columns: string): {
      in(column: string, values: string[]): Promise<{
        data: Array<{ name_lower: string; artist_data: Artist }> | null
        error: { message: string } | null
      }>
    }
    upsert(
      row: {
        name_lower: string
        spotify_artist_id: string
        artist_name: string
        artist_data: Artist
      },
      options: { onConflict: string }
    ): Promise<{ error: { message: string } | null }>
  }
}

const TABLE = "artist_search_cache"

/**
 * Max names per `.in()` call. PostgREST encodes `.in()` into the URL
 * query string, so very large lists trip Cloudflare's 414 URI-too-large
 * limit (observed in practice around ~2-3k names, depending on average
 * name length). 500 is well under that and still means one request per
 * 500 cache lookups — ample for any realistic caller.
 */
const BATCH_READ_CHUNK_SIZE = 500

/**
 * Global cache of artist-name → Spotify-artist lookups.
 * Backed by the `artist_search_cache` Supabase table.
 *
 * Designed to NEVER throw — all failures degrade to "cache miss" so the
 * caller can fall back to a live Spotify search and the engine continues
 * to function even if the table is missing.
 */
export class ArtistNameCache {
  constructor(private readonly client: CacheSupabaseClient) {}

  /**
   * Look up many names at once. Returns a Map keyed by lowercased name.
   * Names not in the cache are simply absent from the returned Map.
   * On any error (table missing, connection failure), returns an empty Map
   * and logs `[cache-search]` so the caller falls back to live search.
   */
  async batchRead(names: string[]): Promise<Map<string, Artist>> {
    const out = new Map<string, Artist>()
    if (names.length === 0) {
      console.log(`[cache-search] hit=0 miss=0 total=0`)
      return out
    }

    const lowered = names.map((n) => n.toLowerCase())

    for (let i = 0; i < lowered.length; i += BATCH_READ_CHUNK_SIZE) {
      const chunk = lowered.slice(i, i + BATCH_READ_CHUNK_SIZE)
      try {
        const { data, error } = await this.client
          .from(TABLE)
          .select("name_lower, artist_data")
          .in("name_lower", chunk)

        if (error) {
          console.log(
            `[cache-search] read-fail err="${error.message}" ` +
            `chunk=${i}-${i + chunk.length} total=${names.length}`
          )
          return out
        }

        for (const row of data ?? []) {
          out.set(row.name_lower, row.artist_data)
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        console.log(
          `[cache-search] read-throw err="${msg}" ` +
          `chunk=${i}-${i + chunk.length} total=${names.length}`
        )
        return out
      }
    }

    const hit = out.size
    const miss = names.length - hit
    console.log(`[cache-search] hit=${hit} miss=${miss} total=${names.length}`)
    return out
  }

  /**
   * Persist a resolved name → artist mapping. Non-blocking: failures are
   * logged but never thrown so a cache write problem cannot break the
   * recommendation generation run.
   */
  async write(name: string, artist: Artist): Promise<void> {
    try {
      const { error } = await this.client.from(TABLE).upsert(
        {
          name_lower: name.toLowerCase(),
          spotify_artist_id: artist.id,
          artist_name: artist.name,
          artist_data: artist,
        },
        { onConflict: "name_lower" }
      )
      if (error) {
        console.log(`[cache-write] fail name="${name}" err="${error.message}"`)
        return
      }
      console.log(`[cache-write] ok name="${name}" id=${artist.id}`)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.log(`[cache-write] throw name="${name}" err="${msg}"`)
    }
  }
}
