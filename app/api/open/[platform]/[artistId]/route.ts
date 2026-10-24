import { NextResponse } from "next/server"
import { apiError } from "@/lib/errors"
import { withAuthedRoute } from "@/lib/api/with-authed-route"
import { isValidArtistId } from "@/lib/spotify-ids"
import { linkFor } from "@/lib/external-links"

const NAME_MAX_LEN = 200

// proxy.ts already gates /api/* behind auth, but this route uses the service
// role to touch a shared cache and redirect; withAuthedRoute requires an
// explicit session so a future proxy config change can't silently expose it.
export const GET = withAuthedRoute(async (
  { request, supabase },
  { params }: { params: Promise<{ platform: string; artistId: string }> }
) => {
  const { platform, artistId } = await params

  if (platform !== "apple_music") {
    return apiError("Direct resolver only supports apple_music", 400)
  }
  if (!isValidArtistId(artistId)) {
    return apiError("Invalid artist id", 400)
  }

  const { searchParams } = new URL(request.url)
  const rawName = (searchParams.get("name") ?? "").trim()
  if (!rawName) {
    return NextResponse.redirect("https://music.apple.com/", 302)
  }
  if (rawName.length > NAME_MAX_LEN) {
    return apiError("Artist name too long", 400)
  }
  const name = rawName

  const target = await linkFor(supabase, { id: artistId, name }, "apple_music")
  return NextResponse.redirect(target, 302)
})
