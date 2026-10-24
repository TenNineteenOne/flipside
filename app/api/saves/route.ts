import { createServiceClient } from "@/lib/supabase/server"
import { apiError, dbError } from "@/lib/errors"
import { isValidArtistId, isValidSpotifyId } from "@/lib/spotify-ids"
import { onTasteChanged } from "@/lib/taste-change"
import { withAuthedJsonRoute } from "@/lib/api/with-authed-route"

export const POST = withAuthedJsonRoute(async ({ userId, body: rawBody }) => {
  const { artistId, spotifyTrackId } = rawBody as { artistId?: string; spotifyTrackId?: string }

  if (!artistId || !isValidArtistId(artistId)) {
    return apiError("Valid artistId (uuid) is required", 400)
  }
  if (spotifyTrackId !== undefined && !isValidSpotifyId(spotifyTrackId)) {
    return apiError("Invalid spotifyTrackId format", 400)
  }

  const supabase = createServiceClient()

  // Resolve artist name from cache
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
    }
  }

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

  // A save is a strong positive signal — invalidate the explore rail cache so
  // the next /explore load picks fresh candidates (the saved artist should
  // not reappear, and adjacent picks may shift). Awaited so the serverless
  // function doesn't terminate mid-delete after the response is sent.
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
