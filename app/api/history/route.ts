import { auth } from "@/lib/auth"
import { createServiceClient } from "@/lib/supabase/server"
import { apiUnauthorized, dbError } from "@/lib/errors"
import { getHistoryPage } from "@/lib/history/query"
import { type NextRequest } from "next/server"

/**
 * GET /api/history
 * Returns recommendation_cache rows where seen_at IS NOT NULL,
 * joined with feedback signal and saves status.
 * Supports pagination via `offset` and `limit` query params.
 */
export async function GET(request: NextRequest): Promise<Response> {
  const session = await auth()
  if (!session?.user?.id) return apiUnauthorized()

  const userId = session.user.id
  const supabase = createServiceClient()

  const url = new URL(request.url)
  const offset = Math.max(0, parseInt(url.searchParams.get("offset") ?? "0", 10) || 0)
  const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get("limit") ?? "50", 10) || 50))

  try {
    const { history, hasMore } = await getHistoryPage(supabase, userId, { offset, limit })
    return Response.json({ history, hasMore })
  } catch (err) {
    return dbError(err as { message: string }, "history/seen")
  }
}
