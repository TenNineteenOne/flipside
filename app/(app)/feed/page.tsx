import { redirect } from "next/navigation"
import { safeAuth } from "@/lib/auth"
import { createServiceClient } from "@/lib/supabase/server"
import { getCachedUser } from "@/lib/user-cache"
import { FeedClient } from "@/components/feed/feed-client"
import { ExplorePrewarm } from "@/components/feed/explore-prewarm"
import { RecommendationsLoader } from "@/components/feed/recommendations-loader"
import { DEFAULT_MUSIC_PLATFORM, isMusicPlatform, type MusicPlatform } from "@/lib/music-links"
import { getUnseenRecommendations, type UnseenRecommendation } from "@/lib/recommendation/feed-query"
import { isRenderableRow, loadFeedCards } from "@/lib/cards/feed-cards"

export default async function FeedPage() {
  const session = await safeAuth()
  if (!session?.user?.id) {
    redirect("/sign-in")
  }

  const userId = session.user.id
  const supabase = createServiceClient()

  // Look up user row (request-scoped cache — layout.tsx already fetched this)
  const user = await getCachedUser(userId)
  if (!user) {
    redirect("/sign-in")
  }

  // Fetch cached recommendations, re-filtered by the user's current
  // underground_mode so a just-toggled setting is honored on first paint
  // instead of waiting for the client poll to replace the list.
  let recs: UnseenRecommendation[]
  try {
    recs = await getUnseenRecommendations(supabase, user.id, {
      limit: 20,
      undergroundMode: !!user.underground_mode,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`[feed-page] recs err="${message}" userId=${user.id}`)
    throw new Error(`Failed to load recommendations: ${message}`)
  }

  // Filter out entries missing essential artist data
  const validRecs = (recs ?? []).filter(isRenderableRow)

  const musicPlatform: MusicPlatform = isMusicPlatform(user.preferred_music_platform)
    ? user.preferred_music_platform
    : DEFAULT_MUSIC_PLATFORM

  // No valid recommendations — client component triggers generation and refreshes
  if (validRecs.length === 0) {
    return (
      <>
        <RecommendationsLoader />
        <ExplorePrewarm />
      </>
    )
  }

  // Assemble cards (tracks-cache fallback, colour lift, playable filter,
  // interleave — see lib/cards/feed-cards) + signal counts in parallel.
  const [
    cards,
    { count: artistCount },
    { count: feedbackCount },
    { count: saveCount },
  ] = await Promise.all([
    loadFeedCards(supabase, validRecs),
    supabase.from("listened_artists").select("*", { count: "exact", head: true }).eq("user_id", user.id),
    supabase.from("feedback").select("*", { count: "exact", head: true }).eq("user_id", user.id).is("deleted_at", null),
    supabase.from("saves").select("*", { count: "exact", head: true }).eq("user_id", user.id),
  ])

  const signalCount = (artistCount ?? 0) + (feedbackCount ?? 0) + (saveCount ?? 0)

  return (
    <>
      <FeedClient recommendations={cards} musicPlatform={musicPlatform} signalCount={signalCount} />
      <ExplorePrewarm />
    </>
  )
}
