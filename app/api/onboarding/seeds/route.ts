import { type NextRequest } from "next/server"
import { auth } from "@/lib/auth"
import { apiError, apiUnauthorized } from "@/lib/errors"
import { createServiceClient } from "@/lib/supabase/server"
import { enforceSameOrigin } from "@/lib/csrf"
import { validateSeedArtists } from "@/lib/seed-artist-validation"

export async function POST(req: NextRequest) {
  const blocked = enforceSameOrigin(req)
  if (blocked) return blocked
  const session = await auth()
  if (!session?.user?.id) return apiUnauthorized()

  const userId = session.user.id

  let body: { artists?: unknown }
  try {
    body = await req.json()
  } catch {
    return apiError("Invalid JSON body", 400)
  }

  const result = validateSeedArtists(body.artists, { min: 3, max: 200 })
  if (!result.ok) return apiError(result.error, 400)

  const supabase = createServiceClient()
  const rows = result.artists.map((a) => ({
    user_id: userId,
    spotify_artist_id: a.id,
    name: a.name,
    image_url: a.imageUrl,
  }))

  const { error } = await supabase
    .from("seed_artists")
    .upsert(rows, { onConflict: "user_id,spotify_artist_id" })

  if (error) {
    console.error("[onboarding/seeds] upsert error:", error.message)
    return apiError("Failed to save seed artists", 500)
  }

  return Response.json({ success: true })
}
