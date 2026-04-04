import { auth } from "@/lib/auth"
import { createServiceClient } from "@/lib/supabase/server"
import { apiError, apiUnauthorized } from "@/lib/errors"
import { getUserId } from "@/lib/groups"

export async function GET(request: Request) {
  const session = await auth()
  if (!session?.user?.spotifyId) return apiUnauthorized()

  const userId = await getUserId(session.user.spotifyId)
  if (!userId) return apiUnauthorized()

  const { searchParams } = new URL(request.url)
  const artistIdsParam = searchParams.get("artistIds")
  if (!artistIdsParam) return Response.json({ activity: {} })

  const artistIds = artistIdsParam
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)

  if (artistIds.length === 0) return Response.json({ activity: {} })

  const supabase = createServiceClient()

  // Fetch group IDs this user belongs to
  const { data: memberRows, error: memberError } = await supabase
    .from("group_members")
    .select("group_id")
    .eq("user_id", userId)

  if (memberError) return apiError(memberError.message)

  const groupIds = (memberRows ?? []).map((row: { group_id: string }) => row.group_id)

  if (groupIds.length === 0) return Response.json({ activity: {} })

  // Fetch group activity for these artists, excluding the current user
  const { data: activityRows, error: activityError } = await supabase
    .from("group_activity")
    .select("spotify_artist_id, user_id, action_type")
    .in("group_id", groupIds)
    .neq("user_id", userId)
    .in("spotify_artist_id", artistIds)
    .order("created_at", { ascending: false })

  if (activityError) return apiError(activityError.message)

  if (!activityRows || activityRows.length === 0) {
    return Response.json({ activity: {} })
  }

  // Collect unique user IDs
  const uniqueUserIds = [...new Set(activityRows.map((row: { user_id: string }) => row.user_id))]

  // Fetch display names for those users
  const { data: userRows, error: userError } = await supabase
    .from("users")
    .select("id, display_name")
    .in("id", uniqueUserIds)

  if (userError) return apiError(userError.message)

  const nameById = new Map<string, string>(
    (userRows ?? []).map((u: { id: string; display_name: string | null }) => [
      u.id,
      u.display_name ?? "A friend",
    ])
  )

  // Build map: artistId → deduplicated array of friend display names
  const activity: Record<string, string[]> = {}

  for (const row of activityRows as { spotify_artist_id: string; user_id: string }[]) {
    const { spotify_artist_id, user_id } = row
    const name = nameById.get(user_id) ?? "A friend"

    if (!activity[spotify_artist_id]) {
      activity[spotify_artist_id] = []
    }

    if (!activity[spotify_artist_id].includes(name)) {
      activity[spotify_artist_id].push(name)
    }
  }

  return Response.json({ activity })
}
