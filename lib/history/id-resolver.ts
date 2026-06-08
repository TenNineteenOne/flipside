import { createServiceClient } from "@/lib/supabase/server"
import { fetchArtistEnrichment } from "@/lib/recommendation/enrich-artist"
import { ensureArtist, type ArtistsSupabaseClient } from "@/lib/artists"

// ── Name → artist_id (uuid) resolution ───────────────────────────────────────

const RESOLUTION_BATCH_SIZE = 10

interface UnresolvedRow {
  id: string
  lastfm_artist_name: string
}

/**
 * For every name-only listened_artists row belonging to `userId` —
 * `artist_id IS NULL AND lastfm_artist_name IS NOT NULL AND
 * spotify_artist_id IS NULL` — that hasn't been attempted in the last 7 days,
 * try to resolve the canonical `artist_id` (uuid) via the `artists` table
 * first, then — since the artist NAME is already known — by confirming the
 * artist exists via Last.fm getInfo (cached) and minting a canonical uuid by
 * name. No live Spotify call: the spotify_id is backfilled later by the #159
 * MusicBrainz worker.
 *
 * The tight filter preserves the old name-only semantics: rows that still carry
 * a legacy `spotify_artist_id` are left to the migration backfill, not this pass.
 *
 * - Table hit  → write artist_id, update id_resolution_attempted_at
 * - getInfo hit → ensureArtist (mint/resolve uuid by name), write artist_id, update timestamp
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

  // 1. Fetch unresolved rows for this user. TIGHT filter: genuine name-only rows
  //    only (artist_id null AND a name present AND no legacy spotify_artist_id).
  //    Rows that still carry a spotify_artist_id are the migration backfill's job.
  const { data: rows, error: fetchError } = await supabase
    .from("listened_artists")
    .select("id, lastfm_artist_name")
    .eq("user_id", userId)
    .is("artist_id", null)
    .not("lastfm_artist_name", "is", null)
    .is("spotify_artist_id", null)
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

  const { data: orphan } = await supabase
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
  batch: UnresolvedRow[]
}): Promise<void> {
  const { supabase, userId, batch } = params
  const now = new Date().toISOString()
  const lastfmApiKey = process.env.LASTFM_API_KEY ?? ""

  // 2a. Batch-read the canonical `artists` table for all names in this batch.
  //     name_lower is NON-unique → a name may map to several artist rows.
  const nameLowers = batch.map((r) => r.lastfm_artist_name.toLowerCase())
  const { data: cacheRows, error: cacheErr } = await supabase
    .from("artists")
    .select("id, spotify_id, name, name_lower")
    .in("name_lower", nameLowers)

  if (cacheErr) {
    console.error(
      "[resolveLastFmArtistIds] artists read error:",
      cacheErr.message
    )
    // Proceed without the table hit — will fall back to mint-by-name
  }

  type ArtistRow = {
    id: string
    spotify_id: string | null
    name: string
    name_lower: string
  }
  // name_lower is non-unique → bucket rows per name and disambiguate below.
  const artistsByLower = new Map<string, ArtistRow[]>()
  for (const row of (cacheRows ?? []) as ArtistRow[]) {
    const bucket = artistsByLower.get(row.name_lower)
    if (bucket) bucket.push(row)
    else artistsByLower.set(row.name_lower, [row])
  }

  for (const row of batch) {
    const nameLower = row.lastfm_artist_name.toLowerCase()
    const candidates = artistsByLower.get(nameLower) ?? []

    // Exactly one row → unambiguous table hit; use its uuid directly.
    // More than one → ambiguous; skip the hit and fall through to mint-by-name
    // (Option B). Zero → cache miss, also falls through.
    if (candidates.length === 1) {
      const hit = candidates[0]
      const res = await resolveOrMergeRow({
        supabase,
        userId,
        orphanId: row.id,
        artistId: hit.id,
        now,
      })
      if (res.error) {
        console.error(
          `[resolveLastFmArtistIds] table-hit update failed for "${row.lastfm_artist_name}":`,
          res.error
        )
      } else {
        console.log(
          `[resolveLastFmArtistIds] table-hit name="${row.lastfm_artist_name}" artist_id=${hit.id} spotifyId=${hit.spotify_id ?? "-"}${res.merged ? " (merged)" : ""}`
        )
      }
      continue
    }

    if (candidates.length > 1) {
      console.log(
        `[resolveLastFmArtistIds] ambiguous name="${row.lastfm_artist_name}" matches=${candidates.length} → mint-by-name`
      )
    }

    // Cache miss (or ambiguous) — the NAME is already known, so confirm the
    // artist exists via Last.fm getInfo (cached) and mint a canonical uuid by
    // name. spotify_id is backfilled later by the #159 MB worker.
    let resolvedUuid: string | null = null

    try {
      const enrichment = await fetchArtistEnrichment(row.lastfm_artist_name, lastfmApiKey)

      if (!enrichment) {
        // Genuine "artist not found" (or no apiKey / transient swallowed to null).
        // Leave unresolved — fall through to the timestamp-only path below.
        console.log(
          `[resolveLastFmArtistIds] no-getInfo name="${row.lastfm_artist_name}" → unresolved`
        )
      } else {
        // Mint/resolve the canonical artists.id (uuid) by name (no spotifyId).
        const uuid = await ensureArtist(
          supabase as unknown as ArtistsSupabaseClient,
          {
            name: row.lastfm_artist_name,
            genres: enrichment.genres,
            popularity: enrichment.popularity,
          }
        )

        if (uuid) {
          resolvedUuid = uuid
          console.log(
            `[resolveLastFmArtistIds] resolved name="${row.lastfm_artist_name}" artist_id=${uuid} (mint-by-name)`
          )
        } else {
          // Mint failed → treat as no-match (degrade, don't throw).
          console.log(
            `[resolveLastFmArtistIds] mint-failed name="${row.lastfm_artist_name}" → unresolved`
          )
        }
      }
    } catch (err) {
      console.error(
        `[resolveLastFmArtistIds] getInfo/mint threw for "${row.lastfm_artist_name}":`,
        err instanceof Error ? err.message : err
      )
    }

    // Write result (resolved uuid or null) + update timestamp.
    // When resolvedUuid is set, the update may trip the (user_id, artist_id)
    // unique constraint if another source already owns that artist — merge in that case.
    if (resolvedUuid) {
      const res = await resolveOrMergeRow({
        supabase,
        userId,
        orphanId: row.id,
        artistId: resolvedUuid,
        now,
      })
      if (res.error) {
        console.error(
          `[resolveLastFmArtistIds] Update failed for "${row.lastfm_artist_name}":`,
          res.error
        )
      } else if (res.merged) {
        console.log(
          `[resolveLastFmArtistIds] merged orphan name="${row.lastfm_artist_name}" into existing artist_id=${resolvedUuid}`
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
