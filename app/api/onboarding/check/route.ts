import { withAuthedRoute } from "@/lib/api/with-authed-route"

// After the auth pivot, onboarding is always needed for new users.
// A user is considered onboarded once they have at least one seed_artist OR lastfm_username set.
export const GET = withAuthedRoute(async ({ userId, supabase }) => {
  const { count: seedCount } = await supabase
    .from("seed_artists")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)

  const { data: user } = await supabase
    .from("users")
    .select("lastfm_username, onboarding_completed_at")
    .eq("id", userId)
    .maybeSingle()

  const hasSeeds = (seedCount ?? 0) > 0
  const hasLastfm = !!user?.lastfm_username
  const hasCompleted = !!user?.onboarding_completed_at

  return Response.json({ needsOnboarding: !hasSeeds && !hasLastfm && !hasCompleted })
})
