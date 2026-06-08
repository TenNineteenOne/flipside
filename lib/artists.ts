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
  /**
   * Spotify artist id — the dedup key for the spotify-id mint path. When
   * present, dedups on `spotify_id`. When absent/null (Last.fm-resolved
   * artists, Stage 2 Spotify-free generation), `ensureArtist` falls back to a
   * get-or-create by `name_lower` — the new row is minted WITHOUT a spotify_id
   * (the #159 backfill worker fills it later).
   */
  spotifyId?: string | null
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
      // Mint-by-name path: look up existing rows for a name_lower.
      eq(column: string, value: string): {
        limit(n: number): Promise<{
          data: Array<{ id: string; spotify_id: string | null; popularity: number | null }> | null
          error: { message: string } | null
        }>
      }
    }
    // Mint-by-name path: insert a name-only row and read the new id back.
    insert(row: ArtistInsertRow): {
      select(columns: string): {
        single(): Promise<{
          data: { id: string } | null
          error: { message: string } | null
        }>
      }
    }
  }
}

/** Row shape for the name-only insert (no spotify_id). */
interface ArtistInsertRow {
  name: string
  name_lower: string
  genres: string[]
  popularity: number | null
  image_url: string | null
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

  const rows: ArtistUpsertRow[] = [...bySpotify.entries()].map(([spotifyId, s]) => ({
    spotify_id: spotifyId,
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

/**
 * Single-artist convenience. Returns the canonical uuid, or null on failure.
 *
 * Two paths:
 *  - `seed.spotifyId` truthy → the existing spotify_id dedup path (unchanged).
 *  - else → get-or-create by `name_lower` (Stage 2 Spotify-free mint). New rows
 *    are minted WITHOUT a spotify_id; the #159 backfill worker fills it later.
 */
export async function ensureArtist(
  client: ArtistsSupabaseClient,
  seed: ArtistSeed,
): Promise<string | null> {
  if (seed.spotifyId) {
    const map = await ensureArtists(client, [seed])
    return map.get(seed.spotifyId) ?? null
  }
  return ensureArtistByName(client, seed)
}

/**
 * Get-or-create an `artists` row keyed on `name_lower` (Spotify-free mint).
 *
 * Reuses any existing row — preferring one that already has a spotify_id (e.g.
 * the 6254 seeded artists), then by popularity — so a Last.fm-resolved name
 * converges onto the canonical row and we don't proliferate duplicates. This is
 * a pragmatic resolution of the rare same-name collision: a single canonical
 * row per name beats minting near-duplicates. When no row exists, inserts a
 * name-only row (no spotify_id) and returns the new id.
 *
 * Never throws — logs + returns null on error, matching the module's style.
 */
async function ensureArtistByName(
  client: ArtistsSupabaseClient,
  seed: ArtistSeed,
): Promise<string | null> {
  const nameLower = seed.name.toLowerCase()

  // 1. Look up existing rows for this name.
  try {
    const { data, error } = await client
      .from(TABLE)
      .select("id, spotify_id, popularity")
      .eq("name_lower", nameLower)
      .limit(5)
    if (error) {
      console.log(`[artists-mint] by-name read-fail name="${nameLower}" err="${error.message}"`)
      return null
    }
    if (data && data.length > 0) {
      // Reuse the best existing row: spotify_id NOT NULL first, then popularity desc.
      const best = [...data].sort((a, b) => {
        const aHas = a.spotify_id ? 1 : 0
        const bHas = b.spotify_id ? 1 : 0
        if (aHas !== bHas) return bHas - aHas
        return (b.popularity ?? 0) - (a.popularity ?? 0)
      })[0]
      return best.id
    }
  } catch (err) {
    console.log(`[artists-mint] by-name read-throw name="${nameLower}" err="${err instanceof Error ? err.message : String(err)}"`)
    return null
  }

  // 2. No existing row — insert a name-only row (no spotify_id).
  try {
    const { data, error } = await client
      .from(TABLE)
      .insert({
        name: seed.name,
        name_lower: nameLower,
        genres: seed.genres ?? [],
        popularity: seed.popularity ?? null,
        image_url: seed.imageUrl ?? null,
      })
      .select("id")
      .single()
    if (error) {
      console.log(`[artists-mint] by-name insert-fail name="${nameLower}" err="${error.message}"`)
      return null
    }
    return data?.id ?? null
  } catch (err) {
    console.log(`[artists-mint] by-name insert-throw name="${nameLower}" err="${err instanceof Error ? err.message : String(err)}"`)
    return null
  }
}
