import { createServiceClient } from "@/lib/supabase/server"
import { apiError, dbError } from "@/lib/errors"
import { isValidArtistId, isValidSpotifyId } from "@/lib/spotify-ids"
import { onTasteChanged } from "@/lib/taste-change"
import { withAuthedJsonRoute } from "@/lib/api/with-authed-route"
import { ensureCurrentChallenge, getISOWeekStart } from "@/lib/challenges/engine"

export const POST = withAuthedJsonRoute(async ({ userId, body: rawBody }) => {
  const { artistId, spotifyTrackId } = rawBody as { artistId?: string; spotifyTrackId?: string }

  if (!artistId || !isValidArtistId(artistId)) {
    return apiError("Valid artistId (uuid) is required", 400)
  }
  if (spotifyTrackId !== undefined && !isValidSpotifyId(spotifyTrackId)) {
    return apiError("Invalid spotifyTrackId format", 400)
  }

  const supabase = createServiceClient()

  // Resolve artist name: the user's recommendation_cache row first, then the
  // canonical `artists` row (artists outside recommendation_cache, e.g. from
  // the retired Explore page, otherwise showed the raw uuid on /saved).
  let resolvedArtistName = ""
  {
    const { data: cached } = await supabase
      .from("recommendation_cache")
      .select("artist_data")
      .eq("user_id", userId)
      .eq("artist_id", artistId)
      .maybeSingle()
    if (cached?.artist_data?.name) {
      resolvedArtistName = cached.artist_data.name
    } else {
      const { data: artist } = await supabase
        .from("artists")
        .select("name")
        .eq("id", artistId)
        .maybeSingle()
      if (artist?.name) resolvedArtistName = artist.name
    }
  }

  // Only a brand-new row counts toward the weekly challenge (re-saves don't).
  const { data: existingSave } = await supabase
    .from("saves")
    .select("artist_id")
    .eq("user_id", userId)
    .eq("artist_id", artistId)
    .maybeSingle()

  // Upsert the artist bookmark (idempotent — unique on user_id + artist_id)
  const { error: saveError } = await supabase
    .from("saves")
    .upsert(
      {
        user_id: userId,
        artist_id: artistId,
        spotify_track_id: spotifyTrackId ?? null,
        artist_name: resolvedArtistName || null,
      },
      { onConflict: "user_id,artist_id" }
    )

  if (saveError) return dbError(saveError, "saves/upsert")

  if (!existingSave) {
    // The progress RPC no-ops without this week's row, so assign it first. Best-effort.
    try {
      await ensureCurrentChallenge(supabase, userId)
      const { error: rpcError } = await supabase.rpc("rpc_increment_challenge_progress", {
        p_user_id: userId,
        p_week_start: getISOWeekStart(),
        p_signal: "save",
        p_increment: 1,
      })
      if (rpcError) console.error(`[saves] challenge-progress err=${rpcError.message}`)
    } catch (err) {
      console.error("[saves] challenge credit failed", err instanceof Error ? err.message : err)
    }
  }

  // A save is a taste signal (see lib/taste-change). Awaited so the serverless
  // function doesn't terminate mid-write after the response is sent.
  await onTasteChanged(supabase, userId, { kind: "save" })

  const { error: seenError } = await supabase
    .from("recommendation_cache")
    .update({ seen_at: new Date().toISOString() })
    .eq("user_id", userId)
    .eq("artist_id", artistId)
  if (seenError) console.error(`[saves] seen_at err=${seenError.message}`)

  // playlistId is always null: the Spotify-playlist branch was removed with the
  // dead user-token surface (#175 A1). Kept in the body for response-shape parity.
  return Response.json({ success: true, saved: true, playlistId: null })
})

export const DELETE = withAuthedJsonRoute(async ({ userId, body: rawBody }) => {
  const { artistId } = rawBody as { artistId?: string }
  if (!artistId || !isValidArtistId(artistId)) {
    return apiError("Valid artistId (uuid) is required", 400)
  }

  const supabase = createServiceClient()
  const { error } = await supabase
    .from("saves")
    .delete()
    .eq("user_id", userId)
    .eq("artist_id", artistId)

  if (error) return dbError(error, "saves/delete")

  await onTasteChanged(supabase, userId, { kind: "save" })

  return Response.json({ success: true })
})
