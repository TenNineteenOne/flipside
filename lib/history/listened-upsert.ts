import type { createServiceClient } from "@/lib/supabase/server"

type SupabaseClient = ReturnType<typeof createServiceClient>

export interface UpsertListenedArtistsParams {
  supabase: SupabaseClient
  userId: string
  /** Unique keys to upsert — already deduplicated by the caller. */
  keys: string[]
  keyColumn: "artist_id" | "lastfm_artist_name"
  source: string
  /** Chunk the existing-rows SELECT's IN-list at this size. Omit for one unchunked query. */
  chunkSize?: number
  /** On a 23505 batch-insert conflict, retry row-by-row (swallowing further 23505s). */
  conflictFallback?: boolean
  /** e.g. "[accumulateLastFmHistory]" */
  logPrefix: string
  /** Text between logPrefix and "insert=N update=N", e.g. "batch", "resolved batch". */
  logLabel: string
  /** Appended to insert / row-insert / update error messages, e.g. " (resolved)", " (names)". */
  errorSuffix?: string
  /** Appended to the select error message only (independent of errorSuffix — see #C7). */
  selectErrorSuffix?: string
}

/**
 * Shared select-existing → partition insert-vs-bump-play-count → batch insert
 * → update onConflict:"id" upsert dance for listened_artists, used by every
 * history syncer (Last.fm, Spotify, stats.fm resolved + name-only rows). #C7.
 */
export async function upsertListenedArtists(params: UpsertListenedArtistsParams): Promise<void> {
  const {
    supabase,
    userId,
    keys,
    keyColumn,
    source,
    chunkSize,
    conflictFallback = false,
    logPrefix,
    logLabel,
    errorSuffix = "",
    selectErrorSuffix = "",
  } = params
  if (keys.length === 0) return

  const now = new Date().toISOString()

  const selectChunk = (chunk: string[]) =>
    supabase
      .from("listened_artists")
      .select(`id, ${keyColumn}`)
      .eq("user_id", userId)
      .in(keyColumn, chunk)

  const existingRows: Array<{ id: string; key: string | null }> = []

  const chunks = chunkSize
    ? Array.from({ length: Math.ceil(keys.length / chunkSize) }, (_, i) =>
        keys.slice(i * chunkSize, i * chunkSize + chunkSize)
      )
    : [keys]

  const chunkResults = await Promise.all(chunks.map(selectChunk))
  for (const { data, error } of chunkResults) {
    if (error) {
      console.error(`${logPrefix} Batch select${selectErrorSuffix} error:`, error.message)
      return
    }
    if (data) {
      for (const row of data as Array<Record<string, unknown>>) {
        existingRows.push({
          id: row.id as string,
          key: (row[keyColumn] as string | null) ?? null,
        })
      }
    }
  }

  const existingMap = new Map<string, string>()
  for (const row of existingRows) {
    if (row.key) existingMap.set(row.key, row.id)
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
      if (conflictFallback && insertError.code === "23505") {
        // Concurrent sync from another source already inserted a row for one of
        // these keys (name-only via the unresolved-name unique, or artist_id via
        // the (user_id, artist_id) unique). Fall back to per-row insert so one
        // conflict doesn't drop the whole batch — key-agnostic, works for either
        // unique. A per-row 23505 just means the row already exists → skip it.
        for (const row of toInsert) {
          const { error: rowErr } = await supabase.from("listened_artists").insert(row)
          if (rowErr && rowErr.code !== "23505") {
            console.error(`${logPrefix} Row insert${errorSuffix} error:`, rowErr.message)
          }
        }
      } else {
        console.error(`${logPrefix} Batch insert${errorSuffix} error:`, insertError.message)
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
      console.error(`${logPrefix} Batch update${errorSuffix} error:`, bumpError.message)
    }
  }

  console.log(`${logPrefix} ${logLabel} insert=${toInsert.length} update=${bumpIds.length}`)
}
