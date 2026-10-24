import { safeAuth } from "@/lib/auth"
import { createServiceClient } from "@/lib/supabase/server"
import { apiUnauthorized, dbError } from "@/lib/errors"
import { getUnseenRecommendations } from "@/lib/recommendation/feed-query"
import { loadFeedCards } from "@/lib/cards/feed-cards"

export async function GET(): Promise<Response> {
  const session = await safeAuth()
  if (!session?.user?.id) return apiUnauthorized()

  const userId = session.user.id
  const supabase = createServiceClient()

  // underground_mode lookup happens inside getUnseenRecommendations, in
  // parallel with the cache fetch.
  let recommendations
  try {
    const rows = await getUnseenRecommendations(supabase, userId, { limit: 20 })
    // Same assembler as the feed page's first paint, so appended cards carry
    // their extracted colour, tracks-cache fallback and interleave order.
    recommendations = await loadFeedCards(supabase, rows)
  } catch (err) {
    return dbError(err as { message: string }, "recommendations/fetch")
  }

  // Return empty — client will trigger POST /api/recommendations/generate via useEffect
  return Response.json({ recommendations, generating: false })
}
