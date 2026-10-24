import { createServiceClient } from "@/lib/supabase/server"
import { ArtistIdentity } from "@/lib/artist-identity"
import { lastfm } from "@/lib/lastfm"

// ── Name → artist_id (uuid) resolution ───────────────────────────────────────

const RESOLUTION_BATCH_SIZE = 10

interface UnresolvedRow {
  id: string
  lastfm_artist_name: string
}

/**
 * For every name-only listened_artists row belonging to `userId` —
 * `artist_id IS NULL AND lastfm_artist_name IS NOT NULL` — that hasn't been
 * attempted in the last 7 days, resolve the canonical `artist_id` (uuid) via the
 * artist-identity doorway (`ArtistIdentity.resolve`) with a Last.fm getInfo
 * lookup (cached). No live Spotify call: the spotify_id is backfilled later by
 * the #159 MusicBrainz worker.
 *
 * - Resolved   → write artist_id, update id_resolution_attempted_at
 * - No match   → leave artist_id null, update timestamp (retry after 7 days)
 *
 * Processed in batches of RESOLUTION_BATCH_SIZE. The getInfo calls are cached
 * and share the global Last.fm limiter, so this stays within rate budget.
 * Never throws — all errors are logged so the parent sync call is not disrupted.
 */
export async function resolveUnresolvedArtistIds(params: {
  supabase: ReturnType<typeof createServiceClient>
  userId: string
}): Promise<void> {
  const { supabase, userId } = params

  // 1. Fetch unresolved rows for this user: genuine name-only rows
  //    (artist_id null AND a name present) not attempted in the last 7 days.
  const { data: rows, error: fetchError } = await supabase
    .from("listened_artists")
    .select("id, lastfm_artist_name")
    .eq("user_id", userId)
    .is("artist_id", null)
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
    await resolveLastFmBatch({ supabase, userId, batch })
  }
}

/**
 * Try to set artist_id on `orphanId`. If a row with the same
 * (user_id, artist_id) already exists (unique constraint 23505), merge the
 * orphan's play_count into the existing row and delete the orphan.
 *
 * Safeguard: if the merge can't find the target row by artist_id (the gap
 * 3-row edge where the conflicting row is identified by some other column),
 * log `merge-miss` and return `{merged:false}` rather than looping.
 */
async function resolveOrMergeRow(params: {
  supabase: ReturnType<typeof createServiceClient>
  userId: string
  orphanId: string
  artistId: string
  now: string
}): Promise<{ merged: boolean; error?: string }> {
  const { supabase, userId, orphanId, artistId, now } = params

  const { error: updateErr } = await supabase
    .from("listened_artists")
    .update({ artist_id: artistId, id_resolution_attempted_at: now })
    .eq("id", orphanId)

  if (!updateErr) return { merged: false }
  if (updateErr.code !== "23505") return { merged: false, error: updateErr.message }

  const { data: orphan, error: orphanErr } = await supabase
    .from("listened_artists")
    .select("play_count, last_seen_at")
    .eq("id", orphanId)
    .maybeSingle()

  const { data: target } = await supabase
    .from("listened_artists")
    .select("id, play_count, last_seen_at")
    .eq("user_id", userId)
    .eq("artist_id", artistId)
    .maybeSingle()

  if (!target) {
    // 23505 tripped but we can't locate the conflicting row by artist_id.
    // Don't loop — leave the orphan in place (still name-only) and move on.
    console.log(`[id-resolver] merge-miss artist_id=${artistId} orphan=${orphanId}`)
    return { merged: false }
  }

  if (orphanErr || !orphan) {
    // Can't read the orphan's plays — deleting it now would lose them. Leave it.
    console.log(`[id-resolver] merge-orphan-read-fail orphan=${orphanId} err="${orphanErr?.message ?? "no row"}"`)
    return { merged: false, error: orphanErr?.message ?? "orphan row not found" }
  }

  // ponytail: read-modify-write; rpc_bump_listened_play_counts (0041) only does
  // +1, so it can't add the orphan's count. A concurrent bump on the target in
  // this window can still be lost — needs an add-N RPC (migration) to close.
  const mergedPlays = (target.play_count ?? 0) + (orphan.play_count ?? 0)
  const mergedLastSeen =
    new Date(target.last_seen_at).getTime() >= new Date(orphan.last_seen_at).getTime()
      ? target.last_seen_at
      : orphan.last_seen_at
  const { error: mergeErr } = await supabase
    .from("listened_artists")
    .update({ play_count: mergedPlays, last_seen_at: mergedLastSeen })
    .eq("id", target.id)
  if (mergeErr) {
    // Only delete the orphan once its plays are safely folded into the target.
    console.log(`[id-resolver] merge-update-fail target=${target.id} orphan=${orphanId} err="${mergeErr.message}"`)
    return { merged: false, error: mergeErr.message }
  }

  const { error: deleteErr } = await supabase.from("listened_artists").delete().eq("id", orphanId)
  if (deleteErr) {
    // Plays are already merged; a surviving orphan would double-count. Log loudly.
    console.log(`[id-resolver] merge-delete-fail orphan=${orphanId} err="${deleteErr.message}"`)
    return { merged: true, error: deleteErr.message }
  }
  return { merged: true }
}

async function resolveLastFmBatch(params: {
  supabase: ReturnType<typeof createServiceClient>
  userId: string
  batch: UnresolvedRow[]
}): Promise<void> {
  const { supabase, userId, batch } = params
  const now = new Date().toISOString()

  // 2a. Resolve the batch through the artist-identity doorway. An unambiguous
  //     `artists` name hit is used directly; otherwise — since the NAME is
  //     already known — confirm the artist exists via Last.fm getInfo (cached)
  //     and land on the stable by-name row (minting one if none exists).
  //     spotify_id is backfilled later by the #159 MB worker.
  const identity = new ArtistIdentity(supabase)
  // Names getInfo confirmed — absent from `resolved` afterwards means the mint failed.
  const confirmed = new Set<string>()
  const resolved = await identity.resolve(
    batch.map((r) => r.lastfm_artist_name),
    async (name) => {
      try {
        const enrichment = await lastfm.artistInfo(name)
        if (!enrichment) {
          // Genuine "artist not found" (or no apiKey / transient swallowed to null).
          console.log(`[resolveLastFmArtistIds] no-getInfo name="${name}" → unresolved`)
          return null
        }
        confirmed.add(name)
        return { name, genres: enrichment.genres, popularity: enrichment.popularity }
      } catch (err) {
        console.error(
          `[resolveLastFmArtistIds] getInfo/mint threw for "${name}":`,
          err instanceof Error ? err.message : err
        )
        return null
      }
    },
  )

  for (const row of batch) {
    const artist = resolved.get(row.lastfm_artist_name)
    if (!artist && confirmed.has(row.lastfm_artist_name)) {
      // Mint failed → treat as no-match (degrade, don't throw).
      console.log(`[resolveLastFmArtistIds] mint-failed name="${row.lastfm_artist_name}" → unresolved`)
    }

    // Write result (resolved uuid or null) + update timestamp.
    // When resolved, the update may trip the (user_id, artist_id) unique
    // constraint if another source already owns that artist — merge in that case.
    if (artist) {
      const res = await resolveOrMergeRow({
        supabase,
        userId,
        orphanId: row.id,
        artistId: artist.id,
        now,
      })
      if (res.error) {
        console.error(
          `[resolveLastFmArtistIds] Update failed for "${row.lastfm_artist_name}":`,
          res.error
        )
      } else {
        console.log(
          `[resolveLastFmArtistIds] resolved name="${row.lastfm_artist_name}" artist_id=${artist.id} spotifyId=${artist.spotifyId ?? "-"}${res.merged ? " (merged)" : ""}`
        )
      }
    } else {
      // No match — only bump the attempt timestamp; artist_id stays null and the
      // row is retried after the 7-day window.
      const { error: updateErr } = await supabase
        .from("listened_artists")
        .update({ id_resolution_attempted_at: now })
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
