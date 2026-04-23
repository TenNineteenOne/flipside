import { type NextRequest } from "next/server"
import { auth } from "@/lib/auth"
import { apiError, apiUnauthorized } from "@/lib/errors"
import { getSpotifyClientToken } from "@/lib/spotify-client-token"
import { musicProvider } from "@/lib/music-provider/provider"
import { createServiceClient } from "@/lib/supabase/server"
import type { Artist } from "@/lib/music-provider/types"

// Escape %/_/\ so user input can't turn into a wildcard in ILIKE.
function escapeIlike(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_")
}

async function searchCachedArtists(query: string, limit = 10): Promise<Artist[]> {
  try {
    const supabase = createServiceClient()
    const pattern = `${escapeIlike(query.toLowerCase())}%`
    const { data, error } = await supabase
      .from("artist_search_cache")
      .select("artist_data")
      .ilike("name_lower", pattern)
      .limit(limit)
    if (error) {
      console.log(`[onboard-search] cache-fallback read-fail err="${error.message}"`)
      return []
    }
    return (data ?? []).map((r) => r.artist_data as Artist)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.log(`[onboard-search] cache-fallback throw err="${msg}"`)
    return []
  }
}

// Artist search during onboarding uses server-side client credentials (no user OAuth needed).
export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    console.log("[onboard-search] unauth")
    return apiUnauthorized()
  }

  const query = req.nextUrl.searchParams.get("q")
  if (!query || query.trim().length === 0) {
    return apiError("Query parameter 'q' is required", 400)
  }
  if (query.trim().length > 200) {
    return apiError("Query too long", 400)
  }

  const trimmed = query.trim()
  const accessToken = await getSpotifyClientToken()
  if (!accessToken) {
    console.error("[onboard-search] no client token — check SPOTIFY_CLIENT_ID/SECRET")
    return apiError("Spotify unavailable", 503)
  }

  const result = await musicProvider.searchArtists(accessToken, trimmed)

  if (!Array.isArray(result)) {
    const cached = await searchCachedArtists(trimmed)
    console.log(
      `[onboard-search] 429 query="${trimmed}" retry-after=${result.retryAfterSec}s ` +
      `fallback-cache-n=${cached.length}`
    )
    if (cached.length > 0) {
      return Response.json({ artists: cached, degraded: true })
    }
    return apiError("Rate limited, try again in a moment", 429)
  }

  console.log(`[onboard-search] q="${trimmed}" n=${result.length}`)
  return Response.json({ artists: result })
}
