import type { createServiceClient } from "@/lib/supabase/server"
import { ArtistIdentity } from "@/lib/artist-identity"
import { resolveUnresolvedArtistIds } from "@/lib/history/id-resolver"

type SupabaseClient = ReturnType<typeof createServiceClient>

export type ListenSource = "lastfm" | "statsfm"

/**
 * One listened artist from a history source. `spotifyId` is evidence (mint by id).
 * `plays` is the source's REAL play count for the artist, when it gives one (#215).
 */
export interface Listen {
  name: string
  spotifyId?: string | null
  plays?: number
}

/** key → real play count; `undefined` = the source gave none (count sightings instead). */
type PlaysByKey = Map<string, number | undefined>

function notePlays(map: PlaysByKey, key: string, plays: number | undefined): void {
  const prev = map.get(key)
  map.set(key, prev === undefined ? plays : plays === undefined ? prev : Math.max(prev, plays))
}

const LOG_PREFIX: Record<ListenSource, string> = {
  lastfm: "[accumulateLastFmHistory]",
  statsfm: "[accumulateStatsFmHistory]",
}

// `.in()` goes in the request URL: 200 uuids (or names) per request stays well
// under the URL length limit; 500 uuids was ~18 KB (#222).
const CHUNK = 200
// How many play-count writes run at once.
const WRITE_CONCURRENCY = 8

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
  const names: PlaysByKey = new Map()
  for (const l of listens) if (!l.spotifyId) notePlays(names, l.name, l.plays)

  if (withId.length > 0) {
    const idMap = await new ArtistIdentity(supabase).ensureBySpotifyId(withId)
    const uuids: PlaysByKey = new Map()
    for (const l of withId) {
      const uuid = idMap.get(l.spotifyId as string)
      if (uuid) notePlays(uuids, uuid, l.plays)
    }
    if (uuids.size === 0) {
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
 * select-existing → partition insert-vs-update → batch insert (per-row fallback
 * on a 23505 conflict) → play_count write, for one key column (#C7).
 *
 * play_count (#215): a key with a real play count stores it, and an existing
 * row is only ever RAISED to it (`play_count < n` guard in the UPDATE, so a
 * concurrent sync from the other source can't be lowered). A key without one
 * keeps the old behaviour: 1 on insert, atomic +1 per sync that sees it.
 * Rows written before #215 hold sync counts and are raised the same way.
 *
 * Throws on a failed select or insert so the sync reports failure; a failed
 * play_count write on an existing row is only logged.
 */
async function upsertListened(
  supabase: SupabaseClient,
  userId: string,
  source: ListenSource,
  keyColumn: "artist_id" | "lastfm_artist_name",
  plays: PlaysByKey,
): Promise<void> {
  const keys = [...plays.keys()]
  if (keys.length === 0) return
  const logPrefix = LOG_PREFIX[source]
  const label = keyColumn === "artist_id" ? "resolved" : "names"
  const now = new Date().toISOString()

  const chunkResults = await Promise.all(
    chunked(keys).map((chunk) =>
      supabase.from("listened_artists").select(`id, ${keyColumn}, play_count`).eq("user_id", userId).in(keyColumn, chunk),
    ),
  )

  const existingMap = new Map<string, { id: string; playCount: number }>()
  for (const { data, error } of chunkResults) {
    if (error) throw new Error(`${logPrefix} Batch select (${label}) error: ${error.message}`)
    for (const row of (data ?? []) as Array<Record<string, unknown>>) {
      const key = row[keyColumn] as string | null
      if (key) existingMap.set(key, { id: row.id as string, playCount: (row.play_count as number | null) ?? 0 })
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
  const bumpIds: string[] = [] // no real count: +1 per sync
  const seenIds: string[] = [] // real count: last_seen_at now…
  const raiseIds = new Map<number, string[]>() // …and play_count raised to the key (count → row ids)
  for (const [key, count] of plays) {
    const existing = existingMap.get(key)
    if (!existing) {
      toInsert.push({
        user_id: userId,
        artist_id: keyColumn === "artist_id" ? key : null,
        lastfm_artist_name: keyColumn === "lastfm_artist_name" ? key : null,
        source,
        play_count: count ?? 1,
        last_seen_at: now,
      })
    } else if (count === undefined) {
      bumpIds.push(existing.id)
    } else {
      seenIds.push(existing.id)
      if (count > existing.playCount) raiseIds.set(count, [...(raiseIds.get(count) ?? []), existing.id])
    }
  }

  type Write = () => PromiseLike<{ error: { message: string } | null }>
  const writes: Write[] = []
  const table = () => supabase.from("listened_artists")

  if (toInsert.length > 0) {
    const { error: insertError } = await table().insert(toInsert)
    if (insertError) {
      if (insertError.code === "23505") {
        // A concurrent sync from another source already inserted a row for one
        // of these keys (name-only via the unresolved-name unique, or artist_id
        // via the (user_id, artist_id) unique). Retry per-row so one conflict
        // doesn't drop the batch; a per-row 23505 means the row exists → raise
        // it to this source's real count (no count: it was just counted, skip).
        for (const row of toInsert) {
          const { error: rowErr } = await table().insert(row)
          if (!rowErr) continue
          if (rowErr.code !== "23505") throw new Error(`${logPrefix} Row insert (${label}) error: ${rowErr.message}`)
          const key = (keyColumn === "artist_id" ? row.artist_id : row.lastfm_artist_name) as string
          if (plays.get(key) !== undefined) {
            writes.push(() =>
              table().update({ play_count: row.play_count, last_seen_at: now }).eq("user_id", userId).eq(keyColumn, key).lt("play_count", row.play_count),
            )
          }
        }
      } else {
        throw new Error(`${logPrefix} Batch insert (${label}) error: ${insertError.message}`)
      }
    }
  }

  if (bumpIds.length > 0) {
    // Atomic play_count + 1 in the DB (0041 RPC) — a read-modify-write here would
    // lose increments from a concurrent sync bumping the same row.
    writes.push(() => supabase.rpc("rpc_bump_listened_play_counts", { p_user_id: userId, p_ids: bumpIds, p_now: now }))
  }
  for (const chunk of chunked(seenIds)) {
    writes.push(() => table().update({ last_seen_at: now }).eq("user_id", userId).in("id", chunk))
  }
  for (const [count, ids] of raiseIds) {
    for (const chunk of chunked(ids)) {
      writes.push(() => table().update({ play_count: count }).eq("user_id", userId).in("id", chunk).lt("play_count", count))
    }
  }

  for (let i = 0; i < writes.length; i += WRITE_CONCURRENCY) {
    const results = await Promise.all(writes.slice(i, i + WRITE_CONCURRENCY).map((write) => write()))
    for (const { error } of results) {
      // Soft: the rows exist; throwing would 500 a sync whose inserts landed.
      if (error) console.error(`${logPrefix} Batch update (${label}) error:`, error.message)
    }
  }

  console.log(`${logPrefix} ${label} batch insert=${toInsert.length} update=${bumpIds.length + seenIds.length}`)
}

function chunked<T>(items: T[]): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += CHUNK) out.push(items.slice(i, i + CHUNK))
  return out
}
