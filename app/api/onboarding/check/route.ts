import { auth } from "@/lib/auth"
import { apiUnauthorized } from "@/lib/errors"
import { createServiceClient } from "@/lib/supabase/server"

// After the auth pivot, onboarding is always needed for new users.
// A user is considered onboarded once they have at least one seed_artist OR lastfm_username set.
export async function GET() {
  const session = await auth()
  if (!session?.user?.id) return apiUnauthorized()

  const userId = session.user.id
  const supabase = createServiceClient()

  const { count: seedCount } = await supabase
    .from("seed_artists")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)

  const { data: user } = await supabase
    .from("users")
    .select("lastfm_username")
    .eq("id", userId)
    .maybeSingle()

  const hasSeeds = (seedCount ?? 0) > 0
  const hasLastfm = !!user?.lastfm_username

  return Response.json({ needsOnboarding: !hasSeeds && !hasLastfm })
}
