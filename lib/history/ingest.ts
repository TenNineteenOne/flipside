import type { createServiceClient } from "@/lib/supabase/server"
import { ArtistIdentity } from "@/lib/artist-identity"
import { resolveUnresolvedArtistIds } from "@/lib/history/id-resolver"

type SupabaseClient = ReturnType<typeof createServiceClient>

export type ListenSource = "lastfm" | "statsfm"

/** One listened artist from a history source. `spotifyId` is evidence (mint by id). */
export interface Listen {
  name: string
  spotifyId?: string | null
}

const LOG_PREFIX: Record<ListenSource, string> = {
  lastfm: "[accumulateLastFmHistory]",
  statsfm: "[accumulateStatsFmHistory]",
}

// Chunk the existing-rows SELECT's IN-list so lifetime imports (up to ~2000
// names) don't produce an oversized WHERE clause.
const CHUNK = 500

/**
 * History ingest pipeline — the ONE place that turns a source's listens into
 * `listened_artists` rows. Sources only fetch + map. Order (load-bearing):
 *
 *  1. listens WITH a spotifyId → mint/resolve uuids via the identity doorway
 *     (rule 1: by spotify_id) → upsert keyed on `artist_id`;
 *  2. listens WITHOUT one → upsert name-only rows keyed on `lastfm_artist_name`;
 *  3. the resolve pass (`resolveUnresolvedArtistIds`) turns name-only rows into
 *     `artist_id`s. Non-blocking: a failure is logged, never thrown, so a
 *     Last.fm/DB hiccup doesn't break the sync response.
 */
export async function ingestListens(
  supabase: SupabaseClient,
  userId: string,
  source: ListenSource,
  listens: Listen[],
): Promise<void> {
  const logPrefix = LOG_PREFIX[source]

  const withId = listens.filter((l) => l.spotifyId)
  const names = [...new Set(listens.filter((l) => !l.spotifyId).map((l) => l.name))]

  if (withId.length > 0) {
    const idMap = await new ArtistIdentity(supabase).ensureBySpotifyId(withId)
    const uuids = [...new Set(idMap.values())]
    if (uuids.length === 0) {
      console.log(`${logPrefix} resolved batch no uuids minted`)
    } else {
      await upsertListened(supabase, userId, source, "artist_id", uuids)
    }
  }
  await upsertListened(supabase, userId, source, "lastfm_artist_name", names)

  try {
    await resolveUnresolvedArtistIds({ supabase, userId })
  } catch (err) {
    console.error(`${logPrefix} Resolution pass failed:`, err instanceof Error ? err.message : err)
  }
}

/**
 * select-existing → partition insert-vs-bump → batch insert (per-row fallback
 * on a 23505 conflict) → atomic play_count bump, for one key column (#C7).
 */
async function upsertListened(
  supabase: SupabaseClient,
  userId: string,
  source: ListenSource,
  keyColumn: "artist_id" | "lastfm_artist_name",
  keys: string[],
): Promise<void> {
  if (keys.length === 0) return
  const logPrefix = LOG_PREFIX[source]
  const label = keyColumn === "artist_id" ? "resolved" : "names"
  const now = new Date().toISOString()

  const chunks: string[][] = []
  for (let i = 0; i < keys.length; i += CHUNK) chunks.push(keys.slice(i, i + CHUNK))
  const chunkResults = await Promise.all(
    chunks.map((chunk) =>
      supabase.from("listened_artists").select(`id, ${keyColumn}`).eq("user_id", userId).in(keyColumn, chunk),
    ),
  )

  const existingMap = new Map<string, string>()
  for (const { data, error } of chunkResults) {
    if (error) {
      console.error(`${logPrefix} Batch select (${label}) error:`, error.message)
      return
    }
    for (const row of (data ?? []) as Array<Record<string, unknown>>) {
      const key = row[keyColumn] as string | null
      if (key) existingMap.set(key, row.id as string)
    }
  }

  const toInsert: Array<{
    user_id: string
    artist_id: string | null
    lastfm_artist_name: string | null
    source: string
    play_count: number
    last_seen_at: string
  }> = []
  const bumpIds: string[] = []
  for (const key of keys) {
    const existingId = existingMap.get(key)
    if (existingId) {
      bumpIds.push(existingId)
    } else {
      toInsert.push({
        user_id: userId,
        artist_id: keyColumn === "artist_id" ? key : null,
        lastfm_artist_name: keyColumn === "lastfm_artist_name" ? key : null,
        source,
        play_count: 1,
        last_seen_at: now,
      })
    }
  }

  if (toInsert.length > 0) {
    const { error: insertError } = await supabase.from("listened_artists").insert(toInsert)
    if (insertError) {
      if (insertError.code === "23505") {
        // A concurrent sync from another source already inserted a row for one
        // of these keys (name-only via the unresolved-name unique, or artist_id
        // via the (user_id, artist_id) unique). Retry per-row so one conflict
        // doesn't drop the batch; a per-row 23505 means the row exists → skip.
        for (const row of toInsert) {
          const { error: rowErr } = await supabase.from("listened_artists").insert(row)
          if (rowErr && rowErr.code !== "23505") {
            console.error(`${logPrefix} Row insert (${label}) error:`, rowErr.message)
          }
        }
      } else {
        console.error(`${logPrefix} Batch insert (${label}) error:`, insertError.message)
      }
    }
  }

  if (bumpIds.length > 0) {
    // Atomic play_count + 1 in the DB (0041 RPC) — a read-modify-write here would
    // lose increments from a concurrent sync bumping the same row.
    const { error: bumpError } = await supabase.rpc("rpc_bump_listened_play_counts", {
      p_user_id: userId,
      p_ids: bumpIds,
      p_now: now,
    })
    if (bumpError) {
      console.error(`${logPrefix} Batch update (${label}) error:`, bumpError.message)
    }
  }

  console.log(`${logPrefix} ${label} batch insert=${toInsert.length} update=${bumpIds.length}`)
}
