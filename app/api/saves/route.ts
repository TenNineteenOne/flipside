import { auth } from "@/lib/auth"
import { createServiceClient } from "@/lib/supabase/server"
import { apiError, apiUnauthorized } from "@/lib/errors"
import { getUserId } from "@/lib/groups"

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

export async function POST(request: Request) {
  // 1. Auth check
  const session = await auth()
  if (!session?.user?.spotifyId || !session?.user?.accessToken) return apiUnauthorized()

  const { spotifyId, accessToken } = session.user as {
    spotifyId: string
    accessToken: string
  }

  // Parse body
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

  // 2. Get userId
  const userId = await getUserId(spotifyId)
  if (!userId) return apiUnauthorized()

  const supabase = createServiceClient()

  // 3. Fetch user record
  const { data: user, error: userError } = await supabase
    .from("users")
    .select("id, spotify_id, flipside_playlist_id")
    .eq("id", userId)
    .single()

  if (userError || !user) return apiError("User not found", 404)

  // 4. Insert into saves
  const { error: saveError } = await supabase
    .from("saves")
    .insert({ user_id: userId, spotify_artist_id: spotifyArtistId, spotify_track_id: spotifyTrackId })

  if (saveError) return apiError(saveError.message)

  // 5. Update recommendation_cache seen_at
  await supabase
    .from("recommendation_cache")
    .update({ seen_at: new Date().toISOString() })
    .eq("user_id", userId)
    .eq("spotify_artist_id", spotifyArtistId)

  // 6. Spotify playlist management
  let playlistId: string = user.flipside_playlist_id ?? ""

  if (!playlistId) {
    // Create playlist
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

      // Save playlist ID to users table
      await supabase
        .from("users")
        .update({ flipside_playlist_id: playlistId })
        .eq("id", userId)
    }
  }

  if (playlistId) {
    // Add track to playlist
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

  // 7. Write group_activity
  const { data: memberships } = await supabase
    .from("group_members")
    .select("group_id")
    .eq("user_id", userId)

  const groupIds: string[] = (memberships ?? []).map((m: any) => m.group_id)

  if (groupIds.length > 0) {
    // Resolve artist name: try recommendation_cache first, fall back to request body
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

  // 8. Return result
  return Response.json({ success: true, playlistId: playlistId || null })
}
