/**
 * PreviewStore — the ONLY code that touches `artist_tracks_cache` (#175 D1).
 *
 * The table is a cross-user cache of each artist's playable previews, keyed by
 * `artist_id` (= artists.id). Per artist it is tri-state:
 *   - no row        → unknown (never confirmed)
 *   - `tracks: []`  → confirmed-empty NEGATIVE (iTunes definitively had nothing
 *                     and there's no Spotify id to try), written as source 'none'
 *   - `tracks: [..]`→ confirmed playable POSITIVE
 *
 * One TTL policy (PREVIEW_TTL_MS, 24h) governs every read that cares about age:
 *   - confirm reads (`rehydrate`): positives have NO TTL (a known preview is
 *     reused forever); negatives are honored only within the TTL.
 *   - the tracks route (`serveTracks`): positives AND negatives refresh after
 *     the TTL.
 *   - display reads (`readForDisplay`): no TTL — a row is a row.
 *
 * Writers: the confirm collector (generation + Explore) and the tracks route.
 * Both go through `upsertGuarded`. The tracks route applies the shared-cache
 * poisoning guard (a row is never written when the name we searched iTunes
 * with disagrees with the canonical `artists.name` for that id); collector
 * writes skip it because they satisfy it by construction (see `collector`).
 */

import type { SupabaseClient } from "@supabase/supabase-js"
import type { Artist, Track } from "@/lib/music-provider/types"
import { isValidArtistId } from "@/lib/spotify-ids"
import type { ConfirmOutcome } from "./confirm-previews"

/** Anything with `.from()` — the real service client or the test fake. */
export type PreviewStoreClient = Pick<SupabaseClient, "from">

/**
 * The one TTL. Deliberately 24h and NOT longer for negatives, because (a) the
 * nightly MusicBrainz backfill (#159) can give a spotifyId-less artist a
 * Spotify id, and a long negative would blind generation to the newly-
 * reachable Spotify preview; (b) iTunes name-spelling mismatches (#164) can
 * yield legitimate-looking empties that should get re-checked soon. The tracks
 * route refreshes positives on the same clock.
 */
export const PREVIEW_TTL_MS = 24 * 60 * 60 * 1000

const TABLE = "artist_tracks_cache"
/** Chunk size for `.in()` reads and batch upserts (PostgREST URL limit). */
const CHUNK = 500

// Process-global tally of rows persisted by the confirm collector, for the
// [explore-timing] log line. Measurement-only (same concurrency caveat as
// api-call-counter): interleaving concurrent builds is acceptable.
let persistedRows = 0
export function snapshotPersisted(): number {
  return persistedRows
}
export function resetPersisted(): void {
  persistedRows = 0
}

export interface ConfirmCollector {
  /** Wire into confirmPlayableTracks so each live confirm is recorded. */
  onConfirmOutcome: (o: ConfirmOutcome) => void
  /** Batch-upsert all collected outcomes. NEVER throws. No-op when empty. */
  flush: () => Promise<void>
}

interface TracksRow {
  artist_id: string
  tracks: Track[]
  source: string
  fetched_at: string
}

const errMsg = (err: unknown) => (err instanceof Error ? err.message : String(err))
const sameName = (a: string, b: string) => a.toLowerCase().trim() === b.toLowerCase().trim()

export class PreviewStore {
  constructor(private readonly client: PreviewStoreClient) {}

  /**
   * Read-for-confirm. Mutates each candidate's artist in place:
   *   positive row (any age)           → `topTracks = cached`
   *   negative row within the TTL      → `knownEmpty = true`
   *   no row / expired negative        → untouched (confirms live)
   * NEVER throws — degrades to no rehydration on any read error.
   */
  async rehydrate(candidates: Array<{ artist: Artist }>): Promise<void> {
    const ids = [...new Set(candidates.map((c) => c.artist.id).filter(Boolean))]
    if (ids.length === 0) return

    const tracksById = new Map<string, Track[]>()
    const knownEmptyIds = new Set<string>()
    const now = Date.now()
    for (let i = 0; i < ids.length; i += CHUNK) {
      const chunk = ids.slice(i, i + CHUNK)
      const { data, error } = await this.client
        .from(TABLE)
        .select("artist_id, tracks, fetched_at")
        .in("artist_id", chunk)
      if (error) {
        console.log(`[engine] rehydrate read-fail err="${error.message}" chunk=${i}-${i + chunk.length} total=${ids.length}`)
        return // degrade to no rehydration
      }
      for (const row of data ?? []) {
        const id = row.artist_id as string | null
        if (!id) continue
        const tracks = (row.tracks as Track[] | null) ?? []
        if (tracks.length > 0) {
          tracksById.set(id, tracks)
        } else if (row.fetched_at && now - new Date(row.fetched_at as string).getTime() < PREVIEW_TTL_MS) {
          knownEmptyIds.add(id)
        }
      }
    }

    if (tracksById.size === 0 && knownEmptyIds.size === 0) return
    for (const { artist } of candidates) {
      const cached = tracksById.get(artist.id)
      if (cached) {
        artist.topTracks = cached // positive always wins
      } else if (knownEmptyIds.has(artist.id)) {
        artist.knownEmpty = true
      }
    }
  }

  /**
   * Read-for-display: artist_id → stored tracks (no TTL). An id ABSENT from
   * the map has no row; a present `[]` (or all-unplayable list) is a negative.
   * Callers apply `hasPlayablePreview` — nothing without a playable preview
   * renders. A read error yields an empty map (everything drops as no-row).
   */
  async readForDisplay(ids: string[]): Promise<Map<string, Track[]>> {
    const out = new Map<string, Track[]>()
    if (ids.length === 0) return out
    const { data } = await this.client.from(TABLE).select("artist_id, tracks").in("artist_id", ids)
    for (const row of data ?? []) {
      const id = row.artist_id as string | null
      if (!id) continue
      out.set(id, (row.tracks as Track[] | null) ?? [])
    }
    return out
  }

  /**
   * Per-run outcome collector for the confirm step. Dedupes by artistId (last
   * wins), skips non-uuid ids, and on flush batch-upserts one row per artist
   * with `source: 'none'` for confirmed-empty negatives. Which outcomes exist
   * at all is decided by `confirmPlayableTracks`: a source FAILURE never emits
   * (so never writes a negative); a negative is emitted only when iTunes
   * definitively returned nothing playable AND there's no Spotify id.
   */
  collector(): ConfirmCollector {
    const outcomes = new Map<string, ConfirmOutcome>()
    return {
      onConfirmOutcome(o) {
        outcomes.set(o.artistId, o)
      },
      flush: async () => {
        if (outcomes.size === 0) return
        const fetchedAt = new Date().toISOString()
        const rows: Array<TracksRow & { name: string }> = []
        for (const o of outcomes.values()) {
          if (!isValidArtistId(o.artistId)) continue
          rows.push({
            artist_id: o.artistId,
            tracks: o.tracks,
            source: o.definitiveEmpty ? "none" : o.source,
            fetched_at: fetchedAt,
            name: o.name,
          })
        }
        if (rows.length === 0) return
        try {
          // ponytail: no canonical `artists` read here (#175 E4a) — it was one
          // extra round-trip per flush, on Explore's critical path once per rail,
          // and it cannot fire: every collected outcome's name is the doorway
          // artist's name, which is either the roster row's own `name` (name-cache
          // hit) or the input name whose `artistNameDbKey` (= toLowerCase) IS the
          // row's `name_lower` (lookup + ensure by name; Last.fm lookups carry no
          // Spotify id, so ensure never lands on a different-name row). Since
          // `name_lower` is always `name.toLowerCase()`, `sameName` holds. If a
          // writer ever confirms artists NOT from PlayableCandidates.resolve, or a
          // Spotify-id lookup returns to generation, pass `guard: true`.
          const { written, error } = await this.upsertGuarded(rows, "persist-confirms", false)
          const neg = written.filter((r) => r.source === "none").length
          const pos = written.length - neg
          if (error) {
            console.log(`[persist-confirms] fail err="${error}" n=${pos}/${neg}`)
            return
          }
          persistedRows += written.length
          console.log(`[persist-confirms] ok n=${pos}/${neg}`)
        } catch (err) {
          const neg = rows.filter((r) => r.source === "none").length
          console.log(`[persist-confirms] fail err="${errMsg(err)}" n=${rows.length - neg}/${neg}`)
        }
      },
    }
  }

  /**
   * The tracks route's read/refresh/write path. Fresh row → its tracks. Missing
   * or older than PREVIEW_TTL_MS (positive OR negative) → a live iTunes search
   * by `name` (when given); a non-empty result is returned AND written back
   * (guarded). Otherwise a stale positive's stored tracks (not rewritten), else
   * `cacheMiss`. Returns null on a DB read error.
   * The route never writes negatives: an empty live result writes nothing.
   */
  async serveTracks(
    artistId: string,
    name: string | null,
    searchItunes: (name: string) => Promise<Track[] | null>,
  ): Promise<{ tracks: Track[]; cacheMiss?: true } | null> {
    const { data: cached, error } = await this.client
      .from(TABLE)
      .select("tracks, source, fetched_at")
      .eq("artist_id", artistId)
      .maybeSingle()
    if (error) {
      console.error(`[tracks] db-err artistId=${artistId} err=${error.message}`)
      return null
    }

    const age = cached ? Date.now() - new Date(cached.fetched_at as string).getTime() : 0
    if (cached && !(age >= PREVIEW_TTL_MS)) {
      return { tracks: ((cached.tracks ?? []) as Track[]) }
    }

    if (name) {
      try {
        const liveTracks = await searchItunes(name)
        if (liveTracks && liveTracks.length > 0) {
          await this.upsertGuarded(
            [{ artist_id: artistId, tracks: liveTracks, source: "itunes", fetched_at: new Date().toISOString(), name }],
            "tracks",
          )
          return { tracks: liveTracks }
        }
      } catch (err) {
        console.error(`[tracks] API fallback failed:`, err)
      }
    }
    // A stale positive still plays (#175 F-H): serve it (unchanged, so the next
    // request retries the refresh) rather than an empty cache miss.
    const stale = (cached?.tracks ?? []) as Track[]
    if (stale.length > 0) return { tracks: stale }
    return { tracks: [], cacheMiss: true }
  }

  /**
   * Shared-cache poisoning guard + chunked upsert. The table is keyed only by
   * artist_id, so tracks searched under a name that doesn't belong to that id
   * would serve the wrong artist's previews to everyone. Each row's searched
   * `name` is cross-checked against the canonical `artists.name`; a mismatch
   * is skipped (logged). No canonical row / a failed canonical read → allowed.
   * Returns the rows actually sent and the first upsert error, if any.
   */
  private async upsertGuarded(
    rows: Array<TracksRow & { name: string }>,
    tag: string,
    guard = true,
  ): Promise<{ written: TracksRow[]; error: string | null }> {
    const canonical = new Map<string, string>()
    const ids = guard ? rows.map((r) => r.artist_id) : []
    for (let i = 0; i < ids.length; i += CHUNK) {
      const { data } = await this.client
        .from("artists")
        .select("id, name")
        .in("id", ids.slice(i, i + CHUNK))
      for (const row of data ?? []) {
        if (row.name) canonical.set(row.id as string, row.name as string)
      }
    }

    const written: TracksRow[] = []
    for (const { name, ...row } of rows) {
      const canon = canonical.get(row.artist_id)
      if (canon && !sameName(canon, name)) {
        console.warn(
          `[${tag}] name/id mismatch — skipping shared cache write artistId=${row.artist_id} suppliedName="${name}" canonical="${canon}"`,
        )
        continue
      }
      written.push(row)
    }

    for (let i = 0; i < written.length; i += CHUNK) {
      const { error } = await this.client
        .from(TABLE)
        .upsert(written.slice(i, i + CHUNK), { onConflict: "artist_id" })
      if (error) return { written, error: error.message }
    }
    return { written, error: null }
  }
}
