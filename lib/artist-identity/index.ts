/**
 * Artist identity — THE doorway (CONTEXT.md, ADR-0001).
 *
 * The single place a name string (Last.fm similar/tag/history, onboarding,
 * seed script) becomes our internal `artists.id` uuid. Every other part of the
 * app looks artists up by uuid. This module owns:
 *
 *  - the ambiguity policy (ADR-0001 decision 2), in ONE place:
 *      1. Two artists with different Spotify ids never share a row. A seed that
 *         carries a `spotifyId` (the only accepted evidence — Last.fm mbids are
 *         hints, never passed in here) resolves ONLY by `spotify_id`, never by
 *         name, so it can't land on a same-name row holding another Spotify id.
 *      2. A bare name (no evidence) reuses the one stable row: exactly one row
 *         → that row; several rows → a deterministic pick (spotify_id NOT NULL
 *         first, popularity desc, id asc — the #161 fix against identity
 *         flapping); no row → mint a name-only row.
 *    `resolve()` / `batchRead()` serve a name WITHOUT a lookup only when it is
 *    unambiguous (exactly one row). An ambiguous name goes through the caller's
 *    lookup, which may supply evidence (a Spotify id) — and when it doesn't,
 *    `ensure()` lands on the deterministic pick using the rows `batchRead()`
 *    already read (one read, not two).
 *  - race-safe mint (insert … on conflict do nothing on `spotify_id`, then a
 *    read-back), chunking (`.in()` lists ≤500 to stay under the 414 limit),
 *  - the fill-only write policy: only empty metadata fields are ever filled.
 *
 * Never throws — DB failures degrade to "absent" / null so the doorway can't
 * break generation, a history sync, or onboarding.
 */
import type { SupabaseClient } from "@supabase/supabase-js"
import type { Artist } from "@/lib/music-provider/types"
import { isValidArtistId } from "@/lib/spotify-ids"
import { artistNameDbKey } from "./name-key"

export { artistNameKey, artistNameDbKey, stringSimilarity, SIMILARITY_THRESHOLD } from "./name-key"

/** The one Supabase port the doorway needs. Fakes pass `{ from }`. */
export type ArtistsClient = Pick<SupabaseClient, "from">

export interface ArtistSeed {
  /** Evidence: dedups on `spotify_id` when present. Absent/null → by-name path. */
  spotifyId?: string | null
  name: string
  genres?: string[]
  popularity?: number | null
  imageUrl?: string | null
}

/** A row of the canonical `artists` table, as the doorway reads it. */
interface ArtistsRow {
  id: string
  spotify_id: string | null
  name: string
  name_lower: string
  genres: string[] | null
  popularity: number | null
  image_url: string | null
}

const TABLE = "artists"
/** PostgREST encodes `.in()` into the URL — keep chunks well under the 414 limit. */
const CHUNK = 500
/**
 * The by-name candidate window. Wide enough to cover the duplicate pile-ups
 * minted before the #161 write fix (worst observed: 16 rows for one name).
 */
const NAME_WINDOW = 20
const ROW_COLS = "id, spotify_id, name, name_lower, genres, popularity, image_url"

const errMsg = (err: unknown) => (err instanceof Error ? err.message : String(err))

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
 * Deterministic pick over same-name rows: the first NAME_WINDOW by id asc, then
 * spotify_id NOT NULL first, popularity desc, id asc. Without the id tiebreak,
 * duplicate rows with equal metadata made the identity flap between
 * generations, bypassing thumbs-down/cooldown filters keyed on artist_id (#161).
 */
function pickRow<T extends { id: string; spotify_id: string | null; popularity: number | null }>(
  rows: T[],
): T {
  const byId = (a: T, b: T) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  return [...rows].sort(byId).slice(0, NAME_WINDOW).sort((a, b) => {
    const aHas = a.spotify_id ? 1 : 0
    const bHas = b.spotify_id ? 1 : 0
    if (aHas !== bHas) return bHas - aHas
    const popDiff = (b.popularity ?? 0) - (a.popularity ?? 0)
    if (popDiff !== 0) return popDiff
    return byId(a, b)
  })[0]
}

export class ArtistIdentity {
  /** Rows of names `batchRead()` found ambiguous — reused by `ensure()` (one read). */
  private readonly ambiguous = new Map<string, ArtistsRow[]>()
  /**
   * Every row `ensure()` landed on (read, picked or minted), by uuid — so
   * `write()` needs no SELECT of its own on the generation hot path (#175 R2)
   * and can hand back the row's own spotify_id / popularity (F-F).
   */
  private readonly rows = new Map<string, ArtistsRow>()

  constructor(private readonly client: ArtistsClient) {}

  /**
   * Names whose identity is settled without a lookup: a Map keyed by
   * `artistNameDbKey(name)` holding the single matching row. Ambiguous (>1
   * row) and unknown names are absent — the caller runs its lookup and then
   * `ensure()`s the result. Errors degrade to the hits gathered so far.
   */
  async batchRead(names: string[]): Promise<Map<string, Artist>> {
    const out = new Map<string, Artist>()
    if (names.length === 0) {
      console.log(`[cache-search] hit=0 miss=0 total=0`)
      return out
    }
    const keys = names.map(artistNameDbKey)
    for (let i = 0; i < keys.length; i += CHUNK) {
      const chunk = keys.slice(i, i + CHUNK)
      try {
        const { data, error } = await this.client.from(TABLE).select(ROW_COLS).in("name_lower", chunk)
        if (error) {
          console.log(`[cache-search] read-fail err="${error.message}" chunk=${i}-${i + chunk.length} total=${names.length}`)
          return out
        }
        const byKey = new Map<string, ArtistsRow[]>()
        for (const row of (data ?? []) as ArtistsRow[]) {
          const list = byKey.get(row.name_lower)
          if (list) list.push(row)
          else byKey.set(row.name_lower, [row])
        }
        for (const [key, rows] of byKey) {
          if (rows.length === 1) {
            out.set(key, rowToArtist(rows[0]))
          } else {
            console.log(`[cache-search] ambiguous name="${key}" rows=${rows.length} → lookup`)
            this.ambiguous.set(key, rows)
          }
        }
      } catch (err) {
        console.log(`[cache-search] read-throw err="${errMsg(err)}" chunk=${i}-${i + chunk.length} total=${names.length}`)
        return out
      }
    }
    console.log(`[cache-search] hit=${out.size} miss=${names.length - out.size} total=${names.length}`)
    return out
  }

  /**
   * The uuid for one resolved artist (rule 1: `spotifyId` → by id only; rule 2:
   * bare name → the stable row, minting one if none exists). Null on failure.
   */
  async ensure(seed: ArtistSeed): Promise<string | null> {
    if (seed.spotifyId) {
      return (await this.ensureBySpotifyId([seed])).get(seed.spotifyId) ?? null
    }
    return this.ensureByName(seed)
  }

  /**
   * Batch rule-1 mint: Map<spotifyId, uuid> for every seed carrying a
   * spotifyId (others are skipped). Insert-if-absent then read back, so
   * concurrent callers converge on one row and existing metadata is never
   * overwritten by a sparse seed.
   */
  async ensureBySpotifyId(seeds: ArtistSeed[]): Promise<Map<string, string>> {
    const out = new Map<string, string>()
    const bySpotify = new Map<string, ArtistSeed>()
    for (const s of seeds) {
      if (s.spotifyId && !bySpotify.has(s.spotifyId)) bySpotify.set(s.spotifyId, s)
    }
    if (bySpotify.size === 0) return out

    const rows = [...bySpotify.entries()].map(([spotifyId, s]) => ({
      spotify_id: spotifyId,
      name: s.name,
      name_lower: artistNameDbKey(s.name),
      genres: s.genres ?? [],
      popularity: s.popularity ?? null,
      image_url: s.imageUrl ?? null,
    }))
    try {
      const { error } = await this.client
        .from(TABLE)
        .upsert(rows, { onConflict: "spotify_id", ignoreDuplicates: true })
      if (error) console.log(`[artists-mint] upsert-fail err="${error.message}"`)
    } catch (err) {
      console.log(`[artists-mint] upsert-throw err="${errMsg(err)}"`)
    }

    const ids = [...bySpotify.keys()]
    for (let i = 0; i < ids.length; i += CHUNK) {
      const chunk = ids.slice(i, i + CHUNK)
      try {
        const { data, error } = await this.client.from(TABLE).select(ROW_COLS).in("spotify_id", chunk)
        if (error) {
          console.log(`[artists-mint] read-fail err="${error.message}" chunk=${i}-${i + chunk.length}`)
          continue
        }
        for (const row of (data ?? []) as ArtistsRow[]) {
          if (!row.spotify_id) continue
          out.set(row.spotify_id, row.id)
          this.rows.set(row.id, row)
        }
      } catch (err) {
        console.log(`[artists-mint] read-throw err="${errMsg(err)}"`)
      }
    }
    console.log(`[artists-mint] seeds=${bySpotify.size} resolved=${out.size}`)
    return out
  }

  /**
   * In-flight by-name ensures, keyed by `name_lower` (#175 F25). Concurrent
   * resolves on ONE instance (feed: primary + secondary + bleed share the run's
   * instance; or "Ghost Band" / "ghost band" in one batch) would otherwise both
   * read "no row" and both insert — `name_lower` isn't unique — minting
   * duplicate uuids (#161 class). Cross-request races still need a DB unique
   * index on name-only rows (owner decision D2, deferred; #168).
   */
  private readonly inflight = new Map<string, Promise<string | null>>()

  private ensureByName(seed: ArtistSeed): Promise<string | null> {
    const nameLower = artistNameDbKey(seed.name)
    const pending = this.inflight.get(nameLower)
    if (pending) return pending
    const p = this.readOrMintByName(seed, nameLower).finally(() => this.inflight.delete(nameLower))
    this.inflight.set(nameLower, p)
    return p
  }

  private keep(row: ArtistsRow): string {
    this.rows.set(row.id, row)
    return row.id
  }

  private async readOrMintByName(seed: ArtistSeed, nameLower: string): Promise<string | null> {
    const known = this.ambiguous.get(nameLower)
    if (known) return this.keep(pickRow(known))

    try {
      const { data, error } = await this.client
        .from(TABLE)
        .select(ROW_COLS)
        .eq("name_lower", nameLower)
        // Without ORDER BY, LIMIT returns an arbitrary page — the pick must see
        // the same window every run.
        .order("id", { ascending: true })
        .limit(NAME_WINDOW)
      if (error) {
        console.log(`[artists-mint] by-name read-fail name="${nameLower}" err="${error.message}"`)
        return null
      }
      const rows = (data ?? []) as ArtistsRow[]
      if (rows.length > 0) return this.keep(pickRow(rows))
    } catch (err) {
      console.log(`[artists-mint] by-name read-throw name="${nameLower}" err="${errMsg(err)}"`)
      return null
    }

    // No row — mint a name-only row (the #159 backfill fills spotify_id later).
    try {
      const insert = {
        name: seed.name,
        name_lower: nameLower,
        genres: seed.genres ?? [],
        popularity: seed.popularity ?? null,
        image_url: seed.imageUrl ?? null,
      }
      const { data, error } = await this.client.from(TABLE).insert(insert).select("id").single()
      if (error) {
        console.log(`[artists-mint] by-name insert-fail name="${nameLower}" err="${error.message}"`)
        return null
      }
      const id = (data as { id: string } | null)?.id
      return id ? this.keep({ id, spotify_id: null, ...insert }) : null
    } catch (err) {
      console.log(`[artists-mint] by-name insert-throw name="${nameLower}" err="${errMsg(err)}"`)
      return null
    }
  }

  /**
   * Full doorway for callers without their own retry machinery: names → Map
   * keyed by the ORIGINAL input name. Unambiguous names resolve from the table;
   * everything else goes through `lookup` (null = not found → absent) and is
   * `ensure()`d. Sequential — callers' lookups are rate-limited anyway.
   */
  async resolve(
    names: string[],
    lookup: (name: string) => Promise<ArtistSeed | null>,
  ): Promise<Map<string, Artist>> {
    const out = new Map<string, Artist>()
    const hits = await this.batchRead(names)
    for (const name of names) {
      const hit = hits.get(artistNameDbKey(name))
      if (hit) {
        out.set(name, hit)
        continue
      }
      let seed: ArtistSeed | null = null
      try {
        seed = await lookup(name)
      } catch (err) {
        console.log(`[artists-resolve] lookup-throw name="${name}" err="${errMsg(err)}"`)
      }
      if (!seed) continue
      const id = await this.ensure(seed)
      if (!id) continue
      out.set(name, {
        id,
        spotifyId: seed.spotifyId ?? null,
        name: seed.name,
        genres: seed.genres ?? [],
        imageUrl: seed.imageUrl ?? null,
        popularity: seed.popularity ?? 0,
      })
    }
    return out
  }

  /**
   * Fill-only metadata patch on the artist's uuid row: a field is written ONLY
   * when the row's value is empty (genres null or [], popularity null,
   * image_url null) and the incoming value is non-empty. Existing values are
   * never overwritten (#175 F24 — an ambiguous name resolved via Last.fm must
   * not stomp a homonym row's Spotify metadata, shifting tiering / the
   * underground cap). `name`/`name_lower`/`spotify_id` are never touched.
   * Popularity 0 counts as empty (#175 R2: the app reads 0 as "unknown", and a
   * mint can store 0 from a getInfo timeout or a tiny listener count).
   * Read-then-update: two concurrent fills of the same empty field can race,
   * but both are fills — an existing value is never replaced. The read is the
   * row `ensure()` already landed on when this instance resolved the artist
   * (no extra SELECT on the generation hot path); otherwise one SELECT.
   *
   * Returns the artist as the roster row holds it (#175 F-F): the row's
   * `spotify_id`, and its popularity when it has one. A name that landed on a
   * homonym's Spotify row must keep that Spotify id (the Spotify preview
   * fallback, and no definitive negative written over it) and score on the
   * row's popularity, not Last.fm's conflated one. Skips (logs) when the
   * artist has no minted uuid. Never throws; on any failure returns `artist`.
   */
  async write(name: string, artist: Artist): Promise<Artist> {
    try {
      if (!isValidArtistId(artist.id)) {
        console.log(`[cache-write] skip name="${name}" (no id)`)
        return artist
      }
      const incoming = artist.genres.length > 0 || artist.popularity > 0 || !!artist.imageUrl
      let row = this.rows.get(artist.id)
      if (!row) {
        if (!incoming) return artist // nothing worth writing
        const { data: current, error: readErr } = await this.client
          .from(TABLE)
          .select(ROW_COLS)
          .eq("id", artist.id)
          .maybeSingle()
        if (readErr || !current) {
          console.log(`[cache-write] read-fail name="${name}" err="${readErr?.message ?? "no row"}"`)
          return artist
        }
        row = current as ArtistsRow
      }
      const stored: Artist = {
        ...artist,
        spotifyId: row.spotify_id ?? artist.spotifyId ?? null,
        popularity: row.popularity ? row.popularity : artist.popularity,
      }
      const patch: { genres?: string[]; popularity?: number; image_url?: string } = {}
      if (artist.genres.length > 0 && !(row.genres?.length)) patch.genres = artist.genres
      if (artist.popularity > 0 && !row.popularity) patch.popularity = artist.popularity
      if (artist.imageUrl && !row.image_url) patch.image_url = artist.imageUrl
      if (Object.keys(patch).length === 0) return stored // row already filled
      const { error } = await this.client.from(TABLE).update(patch).eq("id", artist.id)
      if (error) {
        console.log(`[cache-write] fail name="${name}" err="${error.message}"`)
        return stored
      }
      this.rows.set(artist.id, { ...row, ...patch })
      console.log(`[cache-write] ok name="${name}" spotifyId=${stored.spotifyId ?? "null"}`)
      return stored
    } catch (err) {
      console.log(`[cache-write] throw name="${name}" err="${errMsg(err)}"`)
      return artist
    }
  }
}
