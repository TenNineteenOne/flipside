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

  const accessToken = await getAccessToken(request)
  if (!accessToken) return apiUnauthorized()

  const { spotifyId } = session.user

  let body: { spotifyArtistId?: string; spotifyTrackId?: string; artistName?: string }
  try {
    body = await request.json()
  } catch {
    return apiError("Invalid JSON", 400)
  }

  const { spotifyArtistId, spotifyTrackId, artistName } = body
  if (!spotifyArtistId || !spotifyTrackId) {
    return apiError("spotifyArtistId and spotifyTrackId are required", 400)
  }
  if (!isValidSpotifyId(spotifyArtistId) || !isValidSpotifyId(spotifyTrackId)) {
    return apiError("Invalid Spotify ID format", 400)
  }

  const userId = await getUserId(spotifyId)
  if (!userId) return apiUnauthorized()

  const supabase = createServiceClient()

  const { data: user, error: userError } = await supabase
    .from("users")
    .select("id, spotify_id, flipside_playlist_id")
    .eq("id", userId)
    .single()

  if (userError || !user) return apiError("User not found", 404)

  const { error: saveError } = await supabase
    .from("saves")
    .insert({ user_id: userId, spotify_artist_id: spotifyArtistId, spotify_track_id: spotifyTrackId })

  if (saveError) return dbError(saveError, "saves/insert")

  await supabase
    .from("recommendation_cache")
    .update({ seen_at: new Date().toISOString() })
    .eq("user_id", userId)
    .eq("spotify_artist_id", spotifyArtistId)

  let playlistId: string = user.flipside_playlist_id ?? ""

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

    if (createRes.status === 401) return apiError("Spotify token expired", 401)
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

  const { data: memberships } = await supabase
    .from("group_members")
    .select("group_id")
    .eq("user_id", userId)

  const groupIds: string[] = (memberships ?? []).map((m: any) => m.group_id)

  if (groupIds.length > 0) {
    let resolvedArtistName = artistName ?? ""
    const { data: cached } = await supabase
      .from("recommendation_cache")
      .select("artist_data")
      .eq("user_id", userId)
      .eq("spotify_artist_id", spotifyArtistId)
      .single()

    if (cached?.artist_data?.name) {
      resolvedArtistName = cached.artist_data.name
    }

    const activityRows = groupIds.map((groupId: string) => ({
      id: crypto.randomUUID(),
      user_id: userId,
      group_id: groupId,
      spotify_artist_id: spotifyArtistId,
      artist_name: resolvedArtistName,
      action_type: "save" as const,
    }))

    await supabase.from("group_activity").insert(activityRows)
  }

  return Response.json({ success: true, playlistId: playlistId || null })
}
