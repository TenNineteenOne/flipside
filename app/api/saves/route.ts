import { auth } from "@/lib/auth"
import { createServiceClient } from "@/lib/supabase/server"
import { apiError, apiUnauthorized, dbError } from "@/lib/errors"
import { getAccessToken } from "@/lib/get-access-token"
import { isValidSpotifyId } from "@/lib/spotify-ids"
import { getUserId } from "@/lib/groups"
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
  const session = await auth()
  if (!session?.user?.spotifyId) return apiUnauthorized()

  const { spotifyId } = session.user

  let body: { spotifyArtistId?: string; spotifyTrackId?: string }
  try {
    body = await request.json()
  } catch {
    return apiError("Invalid JSON", 400)
  }

  const { spotifyArtistId, spotifyTrackId } = body

  if (!spotifyArtistId || !isValidSpotifyId(spotifyArtistId)) {
    return apiError("Valid spotifyArtistId is required", 400)
  }
  if (spotifyTrackId !== undefined && !isValidSpotifyId(spotifyTrackId)) {
    return apiError("Invalid spotifyTrackId format", 400)
  }

  const userId = await getUserId(spotifyId)
  if (!userId) return apiUnauthorized()

  const supabase = createServiceClient()

  // Resolve artist name from cache (needed for saves table + group_activity)
  let resolvedArtistName = ""
  {
    const { data: cached } = await supabase
      .from("recommendation_cache")
      .select("artist_data")
      .eq("user_id", userId)
      .eq("spotify_artist_id", spotifyArtistId)
      .single()
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

  await supabase
    .from("recommendation_cache")
    .update({ seen_at: new Date().toISOString() })
    .eq("user_id", userId)
    .eq("spotify_artist_id", spotifyArtistId)

  // Only add to Spotify playlist when a track ID is provided
  let playlistId: string | null = null
  if (spotifyTrackId) {
    const accessToken = await getAccessToken(request)
    if (accessToken) {
      const { data: user } = await supabase
        .from("users")
        .select("id, spotify_id, flipside_playlist_id")
        .eq("id", userId)
        .single()

      if (user) {
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

          if (addRes.status === 401) return apiError("Spotify token expired", 401)
          if (addRes.status === 429) {
            console.warn("[saves] Spotify rate limit hit when adding track — skipping")
          }
        }
      }
    }
  }

  // Write group activity for all groups the user belongs to
  const { data: memberships } = await supabase
    .from("group_members")
    .select("group_id")
    .eq("user_id", userId)

  const groupIds: string[] = (memberships ?? []).map((m: any) => m.group_id)

  if (groupIds.length > 0) {
    const activityRows = groupIds.map((groupId: string) => ({
      user_id: userId,
      group_id: groupId,
      spotify_artist_id: spotifyArtistId,
      artist_name: resolvedArtistName,
      action_type: "save" as const,
    }))

    await supabase
      .from("group_activity")
      .upsert(activityRows, { onConflict: "user_id,group_id,spotify_artist_id", ignoreDuplicates: true })
  }

  return Response.json({ success: true, playlistId: playlistId ?? null })
}
