import { createServiceClient } from "@/lib/supabase/server"
import { apiError, dbError } from "@/lib/errors"
import { getAccessToken } from "@/lib/get-access-token"
import { isValidArtistId, isValidSpotifyId } from "@/lib/spotify-ids"
import { invalidateExploreCache } from "@/lib/recommendation/explore-engine"
import { musicProvider } from "@/lib/music-provider/provider"
import { type NextRequest } from "next/server"
import { withAuthedJsonRoute } from "@/lib/api/with-authed-route"

export const POST = withAuthedJsonRoute(async ({ userId, request, body: rawBody }) => {
  const body = rawBody as { artistId?: string; spotifyTrackId?: string; addToPlaylist?: boolean }
  const { artistId, spotifyTrackId, addToPlaylist = false } = body

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
  await invalidateExploreCache(userId).catch((err) => {
    console.error("[saves] explore-invalidate failed", err)
  })

  const { error: seenError } = await supabase
    .from("recommendation_cache")
    .update({ seen_at: new Date().toISOString() })
    .eq("user_id", userId)
    .eq("artist_id", artistId)
  if (seenError) console.error(`[saves] seen_at err=${seenError.message}`)

  // Only add to Spotify playlist when explicitly requested and user has Spotify access
  let playlistId: string | null = null
  if (spotifyTrackId && addToPlaylist) {
    const accessToken = await getAccessToken(request as NextRequest)
    if (accessToken) {
      const { data: user } = await supabase
        .from("users")
        .select("id, spotify_id, flipside_playlist_id")
        .eq("id", userId)
        .maybeSingle()

      if (user?.spotify_id) {
        playlistId = user.flipside_playlist_id ?? null

        if (!playlistId) {
          // Only the provider call itself is guarded — matching the original route,
          // where a DB-update failure after a successful create was left unhandled
          // (propagates as an uncaught error) rather than swallowed here.
          let created: string | null = null
          try {
            created = await musicProvider.createPlaylist(
              accessToken,
              user.spotify_id,
              "Flipside Discoveries",
              "Tracks saved via Flipside"
            )
          } catch (err) {
            const msg = err instanceof Error ? err.message : "unknown"
            if (msg === "scope_missing") {
              console.warn("[saves] Spotify 403 on playlist create — scope missing or app not approved")
              return apiError("Spotify permission denied for playlist", 403)
            }
            if (msg === "rate_limited") {
              console.warn("[saves] Spotify rate limit hit when creating playlist — skipping")
            }
            // Other failures (auth_expired, http_N): silently continue with playlistId unset,
            // matching the original route's behavior of only branching on 403/429.
          }
          if (created) {
            playlistId = created
            await supabase
              .from("users")
              .update({ flipside_playlist_id: playlistId })
              .eq("id", userId)
          }
        }

        if (playlistId) {
          try {
            await musicProvider.addTracksToPlaylist(accessToken, playlistId, [spotifyTrackId])
          } catch (err) {
            const msg = err instanceof Error ? err.message : "unknown"
            if (msg === "auth_expired") {
              console.warn("[saves] Spotify 401 on track add — token expired")
              return Response.json({ success: true, saved: true, playlistError: "Spotify token expired" })
            }
            if (msg === "scope_missing") {
              console.warn("[saves] Spotify 403 on track add — scope missing or app not approved")
              return Response.json({ success: true, saved: true, playlistError: "Spotify permission denied for playlist" })
            }
            if (msg === "rate_limited") {
              console.warn("[saves] Spotify rate limit hit when adding track — skipping")
              return Response.json({ success: true, saved: true, playlistError: "Spotify rate limit — try again later" })
            }
            // Other failures (http_N): silently continue, matching original fallthrough behavior.
          }
        }
      }
    }
  }

  return Response.json({ success: true, saved: true, playlistId: playlistId ?? null })
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

  await invalidateExploreCache(userId).catch((err) => {
    console.error("[saves] explore-invalidate failed", err)
  })

  return Response.json({ success: true })
})
