import { createServiceClient } from "@/lib/supabase/server"
import { musicProvider } from "@/lib/music-provider/provider"
import { isRateLimited } from "@/lib/music-provider"
import { stringSimilarity, SIMILARITY_THRESHOLD } from "@/lib/history/name-utils"

// ── Last.fm → Spotify ID resolution ──────────────────────────────────────────

const RESOLUTION_BATCH_SIZE = 10

interface UnresolvedRow {
  id: string
  lastfm_artist_name: string
}

/**
 * For every listened_artists row belonging to `userId` that has
 * `spotify_artist_id IS NULL` and hasn't been attempted in the last 7 days,
 * try to resolve the Spotify ID via the artist_search_cache first, then via a
 * live Spotify artist search.
 *
 * - Cache hit  → write spotify_artist_id, update id_resolution_attempted_at
 * - Search hit → write spotify_artist_id, upsert artist_search_cache, update timestamp
 * - No match   → leave spotify_artist_id as null, update timestamp (retry after 7 days)
 *
 * Processed in batches of RESOLUTION_BATCH_SIZE to stay within Spotify rate limits.
 * Never throws — all errors are logged so the parent sync call is not disrupted.
 */
export async function resolveUnresolvedArtistIds(params: {
  supabase: ReturnType<typeof createServiceClient>
  userId: string
  accessToken: string
}): Promise<void> {
  const { supabase, userId, accessToken } = params

  // 1. Fetch unresolved rows for this user
  const { data: rows, error: fetchError } = await supabase
    .from("listened_artists")
    .select("id, lastfm_artist_name")
    .eq("user_id", userId)
    .is("spotify_artist_id", null)
    .not("lastfm_artist_name", "is", null)
    .or(
      "id_resolution_attempted_at.is.null,id_resolution_attempted_at.lt." +
        new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
    )

  if (fetchError) {
    console.error(
      "[resolveLastFmArtistIds] Failed to fetch unresolved rows:",
      fetchError.message
    )
    return
  }

  const unresolved = (rows ?? []) as UnresolvedRow[]
  if (unresolved.length === 0) return

  console.log(`[resolveLastFmArtistIds] Resolving ${unresolved.length} artist(s) for user ${userId}`)

  // 2. Process in batches
  for (let i = 0; i < unresolved.length; i += RESOLUTION_BATCH_SIZE) {
    const batch = unresolved.slice(i, i + RESOLUTION_BATCH_SIZE)
    await resolveLastFmBatch({ supabase, userId, accessToken, batch })
  }
}

/**
 * Try to set spotify_artist_id on `orphanId`. If a row with the same
 * (user_id, spotify_artist_id) already exists (unique constraint 23505),
 * merge the orphan's play_count into the existing row and delete the orphan.
 */
async function resolveOrMergeRow(params: {
  supabase: ReturnType<typeof createServiceClient>
  userId: string
  orphanId: string
  spotifyArtistId: string
  now: string
}): Promise<{ merged: boolean; error?: string }> {
  const { supabase, userId, orphanId, spotifyArtistId, now } = params

  const { error: updateErr } = await supabase
    .from("listened_artists")
    .update({ spotify_artist_id: spotifyArtistId, id_resolution_attempted_at: now })
    .eq("id", orphanId)

  if (!updateErr) return { merged: false }
  if (updateErr.code !== "23505") return { merged: false, error: updateErr.message }

  const { data: orphan } = await supabase
    .from("listened_artists")
    .select("play_count, last_seen_at")
    .eq("id", orphanId)
    .maybeSingle()

  const { data: target } = await supabase
    .from("listened_artists")
    .select("id, play_count, last_seen_at")
    .eq("user_id", userId)
    .eq("spotify_artist_id", spotifyArtistId)
    .maybeSingle()

  if (target && orphan) {
    const mergedPlays = (target.play_count ?? 0) + (orphan.play_count ?? 0)
    const mergedLastSeen =
      new Date(target.last_seen_at).getTime() >= new Date(orphan.last_seen_at).getTime()
        ? target.last_seen_at
        : orphan.last_seen_at
    await supabase
      .from("listened_artists")
      .update({ play_count: mergedPlays, last_seen_at: mergedLastSeen })
      .eq("id", target.id)
  }

  await supabase.from("listened_artists").delete().eq("id", orphanId)
  return { merged: true }
}

async function resolveLastFmBatch(params: {
  supabase: ReturnType<typeof createServiceClient>
  userId: string
  accessToken: string
  batch: UnresolvedRow[]
}): Promise<void> {
  const { supabase, userId, accessToken, batch } = params
  const now = new Date().toISOString()

  // 2a. Batch-read artist_search_cache for all names in this batch
  const nameLowers = batch.map((r) => r.lastfm_artist_name.toLowerCase())
  const { data: cacheRows, error: cacheErr } = await supabase
    .from("artist_search_cache")
    .select("name_lower, spotify_artist_id, artist_name, artist_data")
    .in("name_lower", nameLowers)

  if (cacheErr) {
    console.error(
      "[resolveLastFmArtistIds] Cache read error:",
      cacheErr.message
    )
    // Proceed without cache — will fall back to live search
  }

  type CacheRow = {
    name_lower: string
    spotify_artist_id: string
    artist_name: string
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    artist_data: any
  }
  const cacheByLower = new Map<string, CacheRow>()
  for (const row of (cacheRows ?? []) as CacheRow[]) {
    cacheByLower.set(row.name_lower, row)
  }

  for (const row of batch) {
    const nameLower = row.lastfm_artist_name.toLowerCase()
    const cached = cacheByLower.get(nameLower)

    if (cached) {
      // Cache hit — write spotify_artist_id back to listened_artists, merging
      // into an existing row for this user+artist if the unique constraint
      // (user_id, spotify_artist_id) trips.
      const res = await resolveOrMergeRow({
        supabase,
        userId,
        orphanId: row.id,
        spotifyArtistId: cached.spotify_artist_id,
        now,
      })
      if (res.error) {
        console.error(
          `[resolveLastFmArtistIds] Cache-hit update failed for "${row.lastfm_artist_name}":`,
          res.error
        )
      } else {
        console.log(
          `[resolveLastFmArtistIds] cache-hit name="${row.lastfm_artist_name}" id=${cached.spotify_artist_id}${res.merged ? " (merged)" : ""}`
        )
      }
      continue
    }

    // Cache miss — live Spotify search
    let resolvedId: string | null = null

    try {
      const results = await musicProvider.searchArtists(accessToken, row.lastfm_artist_name)

      if (isRateLimited(results)) {
        // Rate limited — skip this artist for now; retry next sync
        console.warn(
          `[resolveLastFmArtistIds] Rate limited searching "${row.lastfm_artist_name}", skipping`
        )
        // Update timestamp so we don't hammer Spotify again immediately
        await supabase
          .from("listened_artists")
          .update({ id_resolution_attempted_at: now })
          .eq("id", row.id)
        continue
      }

      if (results.length > 0) {
        // Find the best match by name similarity
        const nameLowerOrig = row.lastfm_artist_name.toLowerCase()
        const exactMatch = results.find(
          (a) => a.name.toLowerCase() === nameLowerOrig
        )
        const best = exactMatch ?? results[0]

        const similarity = stringSimilarity(row.lastfm_artist_name, best.name)
        if (similarity >= SIMILARITY_THRESHOLD) {
          resolvedId = best.id

          // Upsert artist_search_cache
          const { error: cacheWriteErr } = await supabase
            .from("artist_search_cache")
            .upsert(
              {
                name_lower: nameLowerOrig,
                spotify_artist_id: best.id,
                artist_name: best.name,
                artist_data: best,
              },
              { onConflict: "name_lower" }
            )

          if (cacheWriteErr) {
            console.error(
              `[resolveLastFmArtistIds] Cache write failed for "${row.lastfm_artist_name}":`,
              cacheWriteErr.message
            )
          }

          console.log(
            `[resolveLastFmArtistIds] resolved name="${row.lastfm_artist_name}" id=${best.id} sim=${similarity.toFixed(2)}`
          )
        } else {
          console.log(
            `[resolveLastFmArtistIds] low-similarity name="${row.lastfm_artist_name}" best="${best.name}" sim=${similarity.toFixed(2)} → unresolved`
          )
        }
      }
    } catch (err) {
      console.error(
        `[resolveLastFmArtistIds] Search threw for "${row.lastfm_artist_name}":`,
        err instanceof Error ? err.message : err
      )
    }

    // Write result (resolved ID or null) + update timestamp.
    // When resolvedId is set, the update may trip the (user_id, spotify_artist_id)
    // unique constraint if another source already owns that artist — merge in that case.
    if (resolvedId) {
      const res = await resolveOrMergeRow({
        supabase,
        userId,
        orphanId: row.id,
        spotifyArtistId: resolvedId,
        now,
      })
      if (res.error) {
        console.error(
          `[resolveLastFmArtistIds] Update failed for "${row.lastfm_artist_name}":`,
          res.error
        )
      } else if (res.merged) {
        console.log(
          `[resolveLastFmArtistIds] merged orphan name="${row.lastfm_artist_name}" into existing id=${resolvedId}`
        )
      }
    } else {
      const { error: updateErr } = await supabase
        .from("listened_artists")
        .update({
          spotify_artist_id: null,  // null stays null — retry via id_resolution_attempted_at window
          id_resolution_attempted_at: now,
        })
        .eq("id", row.id)

      if (updateErr) {
        console.error(
          `[resolveLastFmArtistIds] Timestamp update failed for "${row.lastfm_artist_name}":`,
          updateErr.message
        )
      }
    }
  }
}
