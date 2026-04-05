import { redirect } from "next/navigation"
import { auth } from "@/lib/auth"
import { createServiceClient } from "@/lib/supabase/server"
import { FeedClient } from "@/components/feed/feed-client"
import { RecommendationsLoader } from "@/components/feed/recommendations-loader"

export default async function FeedPage() {
  const session = await auth()
  if (!session?.user?.spotifyId) {
    redirect("/api/auth/signin")
  }

  const supabase = createServiceClient()

  // Upsert user on every login — creates row on first visit, updates profile on subsequent
  const { data: user, error: upsertError } = await supabase
    .from("users")
    .upsert(
      {
        spotify_id: session.user.spotifyId,
        display_name: session.user.displayName ?? null,
        avatar_url: session.user.avatarUrl ?? null,
      },
      { onConflict: "spotify_id" }
    )
    .select("id")
    .single()

  if (upsertError || !user) {
    redirect("/api/auth/signin")
  }

  // Fetch groups this user belongs to
  const { data: memberRows } = await supabase
    .from("group_members")
    .select("groups(id, name)")
    .eq("user_id", user.id)

  const groups: { id: string; name: string }[] = (memberRows ?? [])
    .map((row: any) => row.groups)
    .flat()
    .filter((g: any): g is { id: string; name: string } => g !== null && g !== undefined)

  // Fetch cached recommendations
  const { data: recs } = await supabase
    .from("recommendation_cache")
    .select("spotify_artist_id, artist_data, score, why")
    .eq("user_id", user.id)
    .is("seen_at", null)
    .gt("expires_at", new Date().toISOString())
    .order("score", { ascending: false })
    .limit(20)

  // No recommendations yet — client component triggers generation and refreshes
  if (!recs || recs.length === 0) {
    return <RecommendationsLoader />
  }

  return <FeedClient recommendations={recs} groups={groups} />
}
