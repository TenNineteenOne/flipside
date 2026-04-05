import { redirect } from "next/navigation"
import { auth } from "@/lib/auth"
import { createServiceClient } from "@/lib/supabase/server"
import { FeedClient } from "@/components/feed/feed-client"
import { RecommendationsLoader } from "@/components/feed/recommendations-loader"

interface Rec {
  spotify_artist_id: string
  artist_data: any
  score: number
  why: { sourceArtists: string[]; genres: string[]; friendBoost: string[] }
}

/** Round-robin interleave by primary source artist so results aren't clustered. */
function interleave(recs: Rec[]): Rec[] {
  const buckets = new Map<string, Rec[]>()
  for (const rec of recs) {
    const key = rec.why?.sourceArtists?.[0] ?? "__none"
    if (!buckets.has(key)) buckets.set(key, [])
    buckets.get(key)!.push(rec)
  }
  const groups = Array.from(buckets.values())
  const out: Rec[] = []
  let i = 0
  while (out.length < recs.length) {
    const g = groups[i % groups.length]
    if (g.length > 0) out.push(g.shift()!)
    i++
    if (groups.every((g) => g.length === 0)) break
  }
  return out
}

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

  return <FeedClient recommendations={interleave(recs as Rec[])} groups={groups} />
}
