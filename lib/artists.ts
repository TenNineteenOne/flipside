/**
 * Canonical `artists` mint/resolve helper (Stage 2 surrogate-UUID identity).
 *
 * The single place that turns a resolved Spotify artist into our internal
 * `artists.id` (uuid). Used by the recommendation resolver, the history
 * syncers, and the id-resolver. Race-safe: an `insert … on conflict do
 * nothing` (via upsert + ignoreDuplicates) followed by a read-back, so two
 * concurrent generations for the same artist converge on one row.
 *
 * Never overwrites an existing row's metadata — `ignoreDuplicates` means a
 * placeholder/sparse seed can't clobber a richer existing record (enrichment
 * is the MusicBrainz backfill worker's job, #159).
 *
 * Designed to NEVER throw — failures degrade to "absent from the map" so a
 * mint problem can't break generation or a history sync.
 */

export interface ArtistSeed {
  /** Spotify artist id — the dedup key. Seeds without one are skipped. */
  spotifyId: string
  name: string
  genres?: string[]
  popularity?: number | null
  imageUrl?: string | null
}

interface ArtistUpsertRow {
  spotify_id: string
  name: string
  name_lower: string
  genres: string[]
  popularity: number | null
  image_url: string | null
}

/**
 * Minimal Supabase-client surface used here. Defined locally so tests can
 * pass an in-memory fake without importing the real SDK (mirrors
 * `CacheSupabaseClient` in artist-name-cache.ts).
 */
export interface ArtistsSupabaseClient {
  from(table: string): {
    upsert(
      rows: ArtistUpsertRow[],
      options: { onConflict: string; ignoreDuplicates?: boolean },
    ): Promise<{ error: { message: string } | null }>
    select(columns: string): {
      in(column: string, values: string[]): Promise<{
        data: Array<{ id: string; spotify_id: string | null }> | null
        error: { message: string } | null
      }>
    }
  }
}

const TABLE = "artists"
/** PostgREST encodes `.in()` into the URL — keep chunks well under the 414 limit. */
const CHUNK = 500

/**
 * Ensure an `artists` row exists for each seed's spotifyId; return a
 * Map<spotifyId, artistUuid>. Seeds without a spotifyId are skipped (those are
 * name-only / Last.fm rows whose artist_id stays null until a later resolve).
 */
export async function ensureArtists(
  client: ArtistsSupabaseClient,
  seeds: ArtistSeed[],
): Promise<Map<string, string>> {
  const out = new Map<string, string>()

  // Dedupe by spotifyId; drop empties. First-seen seed wins for the insert row.
  const bySpotify = new Map<string, ArtistSeed>()
  for (const s of seeds) {
    if (s.spotifyId && !bySpotify.has(s.spotifyId)) bySpotify.set(s.spotifyId, s)
  }
  if (bySpotify.size === 0) return out

  const rows: ArtistUpsertRow[] = [...bySpotify.values()].map((s) => ({
    spotify_id: s.spotifyId,
    name: s.name,
    name_lower: s.name.toLowerCase(),
    genres: s.genres ?? [],
    popularity: s.popularity ?? null,
    image_url: s.imageUrl ?? null,
  }))

  // Insert new rows, ignore existing (never clobber real metadata with a seed).
  try {
    const { error } = await client
      .from(TABLE)
      .upsert(rows, { onConflict: "spotify_id", ignoreDuplicates: true })
    if (error) console.log(`[artists-mint] upsert-fail err="${error.message}"`)
  } catch (err) {
    console.log(`[artists-mint] upsert-throw err="${err instanceof Error ? err.message : String(err)}"`)
  }

  // Read back ALL (newly-inserted + pre-existing) to build the spotifyId → uuid map.
  const ids = [...bySpotify.keys()]
  for (let i = 0; i < ids.length; i += CHUNK) {
    const chunk = ids.slice(i, i + CHUNK)
    try {
      const { data, error } = await client.from(TABLE).select("id, spotify_id").in("spotify_id", chunk)
      if (error) {
        console.log(`[artists-mint] read-fail err="${error.message}" chunk=${i}-${i + chunk.length}`)
        continue
      }
      for (const row of data ?? []) {
        if (row.spotify_id) out.set(row.spotify_id, row.id)
      }
    } catch (err) {
      console.log(`[artists-mint] read-throw err="${err instanceof Error ? err.message : String(err)}"`)
    }
  }

  console.log(`[artists-mint] seeds=${bySpotify.size} resolved=${out.size}`)
  return out
}

/** Single-artist convenience. Returns the canonical uuid, or null on failure. */
export async function ensureArtist(
  client: ArtistsSupabaseClient,
  seed: ArtistSeed,
): Promise<string | null> {
  if (!seed.spotifyId) return null
  const map = await ensureArtists(client, [seed])
  return map.get(seed.spotifyId) ?? null
}
