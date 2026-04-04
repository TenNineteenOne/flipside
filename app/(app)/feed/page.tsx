import { redirect } from "next/navigation"
import { Loader2 } from "lucide-react"
import { auth } from "@/lib/auth"
import { createServiceClient } from "@/lib/supabase/server"
import { FeedClient } from "@/components/feed/feed-client"

export default async function FeedPage() {
  const session = await auth()
  if (!session?.user?.spotifyId) {
    redirect("/api/auth/signin")
  }

  const supabase = createServiceClient()

  // Fetch user record
  const { data: user } = await supabase
    .from("users")
    .select("id")
    .eq("spotify_id", session.user.spotifyId)
    .single()

  if (!user) {
    redirect("/api/auth/signin")
  }

  // Fetch groups this user belongs to
  const { data: memberRows } = await supabase
    .from("group_members")
    .select("groups(id, name)")
    .eq("user_id", user.id)

  const groups: { id: string; name: string }[] =
    (memberRows ?? [])
      .map((row: any) => row.groups)
      .flat()
      .filter((g: any): g is { id: string; name: string } => g !== null && g !== undefined)

  // Fetch recommendations
  const { data: recs } = await supabase
    .from("recommendation_cache")
    .select("spotify_artist_id, artist_data, score, why")
    .eq("user_id", user.id)
    .is("seen_at", null)
    .gt("expires_at", new Date().toISOString())
    .order("score", { ascending: false })
    .limit(20)

  const recommendations = recs ?? []

  if (recommendations.length === 0) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 px-4 text-center">
        <div className="flex size-16 items-center justify-center rounded-full bg-primary/10 ring-1 ring-primary/20">
          <Loader2 className="size-8 animate-spin text-primary" />
        </div>
        <div className="space-y-1.5">
          <p className="text-lg font-semibold text-foreground">
            Discovering music for you…
          </p>
          <p className="text-sm text-muted-foreground">
            We&apos;re finding artists you&apos;ll love. This may take a moment on your first visit.
          </p>
        </div>
      </div>
    )
  }

  return <FeedClient recommendations={recommendations} groups={groups} />
}
