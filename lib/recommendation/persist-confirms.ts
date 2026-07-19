/**
 * Persist confirmed previews to `artist_tracks_cache` (#162).
 *
 * The generation and Explore confirm paths learn, per artist, whether a
 * playable preview exists. Before #162 that knowledge was thrown away — only
 * the lazy per-card tracks route ever wrote this table — so Explore dropped its
 * own freshly-confirmed picks and every generation re-paid iTunes. This module
 * collects `ConfirmOutcome`s emitted by `confirmPlayableTracks` and batch-
 * upserts them (positives AND confirmed-empty negatives) so the tracks route,
 * feed rehydration, and Explore hydration all read the same shared rows.
 */

import type { createServiceClient } from "@/lib/supabase/server"
import { isValidArtistId } from "@/lib/spotify-ids"
import type { ConfirmOutcome } from "./confirm-previews"

type SupabaseClient = ReturnType<typeof createServiceClient>

/**
 * Negative-row TTL. Deliberately 24h — same as the tracks route's CACHE_TTL_MS
 * — and NOT longer, because (a) the nightly MusicBrainz backfill (#159) can give
 * a spotifyId-less artist a Spotify id, and a long negative would blind
 * generation to the newly-reachable Spotify preview; (b) iTunes name-spelling
 * mismatches (#164) can yield legitimate-looking empties that should get
 * re-checked soon.
 */
export const NEGATIVE_TTL_MS = 24 * 60 * 60 * 1000

/** Defensive chunk size for the batch upsert (one call unless > this). */
const UPSERT_CHUNK_SIZE = 500

// Process-global tally of rows persisted, for the [explore-timing] log line.
// Measurement-only (same concurrency caveat as api-call-counter): interleaving
// concurrent builds is acceptable — it never drives behavior.
let persistedRows = 0
export function snapshotPersisted(): number {
  return persistedRows
}
export function resetPersisted(): void {
  persistedRows = 0
}

export interface ConfirmCollector {
  /** Wire into buildConfirmPreview so each live confirm is recorded. */
  onConfirmOutcome: (o: ConfirmOutcome) => void
  /** Batch-upsert all collected outcomes. NEVER throws. No-op when empty. */
  flush: (supabase: SupabaseClient) => Promise<void>
}

/**
 * Create a per-run outcome collector. Dedupes by artistId (last write wins),
 * skips non-uuid ids, and on flush batch-upserts one row per artist:
 *   { artist_id, tracks, source, fetched_at }
 * with `source: 'none'` for confirmed-empty negatives. Flush swallows all
 * errors — a cache-write blip must never break generation.
 */
export function createConfirmCollector(): ConfirmCollector {
  const outcomes = new Map<string, ConfirmOutcome>()

  return {
    onConfirmOutcome(o) {
      outcomes.set(o.artistId, o) // dedupe by artistId, last wins
    },

    async flush(supabase) {
      if (outcomes.size === 0) return
      const fetchedAt = new Date().toISOString()
      const rows: Array<{ artist_id: string; tracks: ConfirmOutcome["tracks"]; source: string; fetched_at: string }> = []
      let pos = 0
      let neg = 0
      for (const o of outcomes.values()) {
        if (!isValidArtistId(o.artistId)) continue
        if (o.definitiveEmpty) neg++
        else pos++
        rows.push({
          artist_id: o.artistId,
          tracks: o.tracks,
          source: o.definitiveEmpty ? "none" : o.source,
          fetched_at: fetchedAt,
        })
      }
      if (rows.length === 0) return

      try {
        for (let i = 0; i < rows.length; i += UPSERT_CHUNK_SIZE) {
          const chunk = rows.slice(i, i + UPSERT_CHUNK_SIZE)
          const { error } = await supabase
            .from("artist_tracks_cache")
            .upsert(chunk, { onConflict: "artist_id" })
          if (error) {
            console.log(`[persist-confirms] fail err="${error.message}" n=${pos}/${neg}`)
            return
          }
        }
        persistedRows += rows.length
        console.log(`[persist-confirms] ok n=${pos}/${neg}`)
      } catch (err) {
        console.log(`[persist-confirms] fail err="${err instanceof Error ? err.message : String(err)}" n=${pos}/${neg}`)
      }
    },
  }
}
