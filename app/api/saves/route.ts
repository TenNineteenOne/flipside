import { auth } from "@/lib/auth"
import { createServiceClient } from "@/lib/supabase/server"
import { apiError, apiUnauthorized, dbError } from "@/lib/errors"
import { enforceSameOrigin } from "@/lib/csrf"
import { getAccessToken } from "@/lib/get-access-token"
import { isValidSpotifyId } from "@/lib/spotify-ids"
import { invalidateExploreCache } from "@/lib/recommendation/explore-engine"
import { type NextRequest } from "next/server"

async function spotifyFetch(url: string, accessToken: string, options: RequestInit = {}) {
  const res = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      ...options.headers,
    },
  })
  return res
}

export async function POST(request: NextRequest) {
  const blocked = enforceSameOrigin(request)
  if (blocked) return blocked
  const session = await auth()
  if (!session?.user?.id) return apiUnauthorized()

  const userId = session.user.id

  let body: { spotifyArtistId?: string; spotifyTrackId?: string; addToPlaylist?: boolean }
  try {
    body = await request.json()
  } catch {
    return apiError("Invalid JSON", 400)
  }

  const { spotifyArtistId, spotifyTrackId, addToPlaylist = false } = body

  if (!spotifyArtistId || !isValidSpotifyId(spotifyArtistId)) {
    return apiError("Valid spotifyArtistId is required", 400)
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
      .eq("spotify_artist_id", spotifyArtistId)
      .maybeSingle()
    if (cached?.artist_data?.name) {
      resolvedArtistName = cached.artist_data.name
    }
  }

  // Upsert the artist bookmark (idempotent — unique on user_id + spotify_artist_id)
  const { error: saveError } = await supabase
    .from("saves")
    .upsert(
      {
        user_id: userId,
        spotify_artist_id: spotifyArtistId,
        spotify_track_id: spotifyTrackId ?? null,
        artist_name: resolvedArtistName || null,
      },
      { onConflict: "user_id,spotify_artist_id" }
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
    .eq("spotify_artist_id", spotifyArtistId)
  if (seenError) console.error(`[saves] seen_at err=${seenError.message}`)

  // Only add to Spotify playlist when explicitly requested and user has Spotify access
  let playlistId: string | null = null
  if (spotifyTrackId && addToPlaylist) {
    const accessToken = await getAccessToken(request)
    if (accessToken) {
      const { data: user } = await supabase
        .from("users")
        .select("id, spotify_id, flipside_playlist_id")
        .eq("id", userId)
        .maybeSingle()

      if (user?.spotify_id) {
        playlistId = user.flipside_playlist_id ?? null

        if (!playlistId) {
          const createRes = await spotifyFetch(
            `https://api.spotify.com/v1/users/${user.spotify_id}/playlists`,
            accessToken,
            {
              method: "POST",
              body: JSON.stringify({
                name: "Flipside Discoveries",
                public: false,
                description: "Tracks saved via Flipside",
              }),
            }
          )

          if (createRes.status === 403) {
            console.warn("[saves] Spotify 403 on playlist create — scope missing or app not approved")
            return apiError("Spotify permission denied for playlist", 403)
          }
          if (createRes.status === 429) {
            console.warn("[saves] Spotify rate limit hit when creating playlist — skipping")
          } else if (createRes.ok) {
            const playlist = await createRes.json()
            playlistId = playlist.id
            await supabase
              .from("users")
              .update({ flipside_playlist_id: playlistId })
              .eq("id", userId)
          }
        }

        if (playlistId) {
          const addRes = await spotifyFetch(
            `https://api.spotify.com/v1/playlists/${playlistId}/tracks`,
            accessToken,
            {
              method: "POST",
              body: JSON.stringify({ uris: [`spotify:track:${spotifyTrackId}`] }),
            }
          )

          if (addRes.status === 401) {
            console.warn("[saves] Spotify 401 on track add — token expired")
            return Response.json({ success: true, saved: true, playlistError: "Spotify token expired" })
          }
          if (addRes.status === 403) {
            console.warn("[saves] Spotify 403 on track add — scope missing or app not approved")
            return Response.json({ success: true, saved: true, playlistError: "Spotify permission denied for playlist" })
          }
          if (addRes.status === 429) {
            console.warn("[saves] Spotify rate limit hit when adding track — skipping")
            return Response.json({ success: true, saved: true, playlistError: "Spotify rate limit — try again later" })
          }
        }
      }
    }
  }

  return Response.json({ success: true, saved: true, playlistId: playlistId ?? null })
}

export async function DELETE(request: NextRequest) {
  const blocked = enforceSameOrigin(request)
  if (blocked) return blocked
  const session = await auth()
  if (!session?.user?.id) return apiUnauthorized()

  const userId = session.user.id

  let body: { spotifyArtistId?: string }
  try {
    body = await request.json()
  } catch {
    return apiError("Invalid JSON", 400)
  }

  const { spotifyArtistId } = body
  if (!spotifyArtistId || !isValidSpotifyId(spotifyArtistId)) {
    return apiError("Valid spotifyArtistId is required", 400)
  }

  const supabase = createServiceClient()
  const { error } = await supabase
    .from("saves")
    .delete()
    .eq("user_id", userId)
    .eq("spotify_artist_id", spotifyArtistId)

  if (error) return dbError(error, "saves/delete")

  await invalidateExploreCache(userId).catch((err) => {
    console.error("[saves] explore-invalidate failed", err)
  })

  return Response.json({ success: true })
}
