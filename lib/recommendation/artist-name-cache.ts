import type { Artist } from "@/lib/music-provider/types"

/**
 * Minimal Supabase-client surface area used by ArtistNameCache.
 * Defined locally so tests can pass an in-memory fake without importing
 * the real Supabase SDK.
 *
 * Stage 2: the name cache is FOLDED into the canonical `artists` table — there
 * is no separate `artist_search_cache` table anymore. A cache row IS an
 * `artists` row, keyed by the surrogate uuid `id`; `spotify_id` is now an
 * attribute (nullable). `name_lower` is NON-unique on `artists`, so a name can
 * map to multiple rows; the read path treats that as a cache miss (Option B).
 */
export interface ArtistsRow {
  id: string
  spotify_id: string | null
  name: string
  name_lower: string
  genres: string[] | null
  popularity: number | null
  image_url: string | null
}

export interface CacheSupabaseClient {
  from(table: string): {
    select(columns: string): {
      in(column: string, values: string[]): Promise<{
        data: ArtistsRow[] | null
        error: { message: string } | null
      }>
    }
    upsert(
      row: {
        spotify_id: string | null
        name: string
        name_lower: string
        genres: string[]
        popularity: number
        image_url: string | null
      },
      options: { onConflict?: string; ignoreDuplicates?: boolean }
    ): Promise<{ error: { message: string } | null }>
  }
}

const TABLE = "artists"

/**
 * Max names per `.in()` call. PostgREST encodes `.in()` into the URL
 * query string, so very large lists trip Cloudflare's 414 URI-too-large
 * limit (observed in practice around ~2-3k names, depending on average
 * name length). 500 is well under that and still means one request per
 * 500 cache lookups — ample for any realistic caller.
 */
const BATCH_READ_CHUNK_SIZE = 500

/** Build an Artist from a folded `artists` row. */
function rowToArtist(row: ArtistsRow): Artist {
  return {
    id: row.id,
    spotifyId: row.spotify_id,
    name: row.name,
    genres: row.genres ?? [],
    imageUrl: row.image_url,
    popularity: row.popularity ?? 0,
  }
}

/**
 * Global cache of artist-name → resolved-artist lookups.
 * Backed by the canonical `artists` Supabase table (Stage 2 fold).
 *
 * Designed to NEVER throw — all failures degrade to "cache miss" so the
 * caller can fall back to a live Spotify search and the engine continues
 * to function even if the table is missing.
 */
export class ArtistNameCache {
  constructor(private readonly client: CacheSupabaseClient) {}

  /**
   * Look up many names at once. Returns a Map keyed by lowercased name, with
   * the canonical Artist (uuid identity in `id`, spotify id in `spotifyId`).
   *
   * `name_lower` is NON-unique on `artists`, so a single lowercased name can
   * return multiple rows. Those are AMBIGUOUS and are OMITTED from the map —
   * an ambiguous name is treated as a cache miss so the caller resolves it
   * fresh (Option B: the doorway rule). Names not in the cache are likewise
   * simply absent from the returned Map.
   *
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
          .select("id, spotify_id, name, name_lower, genres, popularity, image_url")
          .in("name_lower", chunk)

        if (error) {
          console.log(
            `[cache-search] read-fail err="${error.message}" ` +
            `chunk=${i}-${i + chunk.length} total=${names.length}`
          )
          return out
        }

        // Group rows by name_lower so we can drop ambiguous (>1 row) names.
        const byNameLower = new Map<string, ArtistsRow[]>()
        for (const row of data ?? []) {
          const key = row.name_lower
          const list = byNameLower.get(key)
          if (list) list.push(row)
          else byNameLower.set(key, [row])
        }
        for (const [nameLower, rows] of byNameLower) {
          if (rows.length !== 1) {
            // Ambiguous: omit → cache miss → caller resolves fresh (Option B).
            console.log(`[cache-search] ambiguous name="${nameLower}" rows=${rows.length} → miss`)
            continue
          }
          out.set(nameLower, rowToArtist(rows[0]))
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
   * Persist a resolved name → artist mapping into the canonical `artists`
   * table. Non-blocking: failures are logged but never thrown so a cache
   * write problem cannot break the recommendation generation run.
   *
   * NEVER writes `artist.id` (the uuid identity) into `spotify_id` — only the
   * real Spotify id (`artist.spotifyId`) goes there. When spotifyId is present
   * the write upserts on `spotify_id` (the dedup key); when it's null there is
   * no conflict target, so it's a best-effort plain insert (a name-only row).
   */
  async write(name: string, artist: Artist): Promise<void> {
    try {
      const row = {
        spotify_id: artist.spotifyId ?? null,
        name: artist.name,
        name_lower: name.toLowerCase(),
        genres: artist.genres,
        popularity: artist.popularity,
        image_url: artist.imageUrl,
      }
      // With a spotify id we can dedup on it; without one there is no unique
      // key to conflict on, so insert best-effort (ignoreDuplicates avoids a
      // hard error if a matching row already exists under some constraint).
      const options = artist.spotifyId
        ? { onConflict: "spotify_id" }
        : { ignoreDuplicates: true }
      const { error } = await this.client.from(TABLE).upsert(row, options)
      if (error) {
        console.log(`[cache-write] fail name="${name}" err="${error.message}"`)
        return
      }
      console.log(`[cache-write] ok name="${name}" spotifyId=${artist.spotifyId ?? "null"}`)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.log(`[cache-write] throw name="${name}" err="${msg}"`)
    }
  }
}
