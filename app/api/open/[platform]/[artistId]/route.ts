import { NextResponse } from "next/server"
import { apiError, apiNotFound } from "@/lib/errors"
import { withAuthedRoute } from "@/lib/api/with-authed-route"
import { isValidArtistId } from "@/lib/spotify-ids"
import { linkFor } from "@/lib/external-links"
import { createWindowLimiter } from "@/lib/rate-limiter"

const NAME_MAX_LEN = 200

// "Open in Apple Music" is a click; 30/min is far above human clicking but
// stops a loop of cache-miss lookups against iTunes.
// ponytail: per-instance in-memory (effective ceiling = 30 × warm instances);
// move to the DB-backed limiter if this must be a hard cap.
const isRateLimited = createWindowLimiter({ max: 30, windowMs: 60_000 })

// proxy.ts already gates /api/* behind auth, but this route uses the service
// role to touch a shared cache and redirect; withAuthedRoute requires an
// explicit session so a future proxy config change can't silently expose it.
export const GET = withAuthedRoute(async (
  { userId, request, supabase },
  { params }: { params: Promise<{ platform: string; artistId: string }> }
) => {
  if (isRateLimited(userId)) {
    return apiError("Too many requests — slow down for a moment", 429)
  }
  const { platform, artistId } = await params

  if (platform !== "apple_music") {
    return apiError("Direct resolver only supports apple_music", 400)
  }
  if (!isValidArtistId(artistId)) {
    return apiError("Invalid artist id", 400)
  }

  // `?name` is validated for response parity only: the lookup uses the
  // `artists` row's name, since the link cache is shared and keyed by id.
  const { searchParams } = new URL(request.url)
  const rawName = (searchParams.get("name") ?? "").trim()
  if (!rawName) {
    return NextResponse.redirect("https://music.apple.com/", 302)
  }
  if (rawName.length > NAME_MAX_LEN) {
    return apiError("Artist name too long", 400)
  }

  const target = await linkFor(supabase, artistId, "apple_music")
  if (!target) return apiNotFound()
  return NextResponse.redirect(target, 302)
})
