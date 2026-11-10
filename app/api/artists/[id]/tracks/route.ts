import { type NextRequest } from "next/server"
import { apiError } from "@/lib/errors"
import { withAuthedRoute } from "@/lib/api/with-authed-route"
import { isValidArtistId } from "@/lib/spotify-ids"
import { searchTracksByArtist } from "@/lib/music-provider/itunes"
import { PreviewStore } from "@/lib/recommendation/preview-store"
import { createWindowLimiter } from "@/lib/rate-limiter"

// Each feed/Explore card without baked tracks fetches once on mount, so heavy
// legit browsing stays far below 120/min; a loop hammering iTunes doesn't.
// ponytail: per-instance in-memory (effective ceiling = 120 × warm instances);
// move to the DB-backed limiter if this must be a hard cap.
const isRateLimited = createWindowLimiter({ max: 120, windowMs: 60_000 })

export const GET = withAuthedRoute(async (
  { userId, request, supabase },
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> => {
  if (isRateLimited(userId)) {
    return apiError("Too many requests — slow down for a moment", 429)
  }
  const req = request as NextRequest
  const { id: artistId } = await params
  if (!isValidArtistId(artistId)) return apiError("Invalid artist ID", 400)

  const artistName = req.nextUrl.searchParams.get("name")
  // Length cap matches /api/onboarding/search and /api/open — bounds the
  // string forwarded to the iTunes search URL.
  if (artistName && artistName.length > 200) {
    return apiError("Artist name too long", 400)
  }

  // Cache-first; a missing or >24h row refreshes from iTunes (by ?name=) and
  // writes back through the preview store's poisoning guard.
  const result = await new PreviewStore(supabase).serveTracks(
    artistId,
    artistName,
    (name) => searchTracksByArtist(name, "US", 5),
  )
  if (!result) return apiError("Failed to load tracks", 500)
  return Response.json(result.cacheMiss ? { tracks: [], cache_miss: true } : { tracks: result.tracks })
})
