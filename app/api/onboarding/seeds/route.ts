import { apiError } from "@/lib/errors"
import { createServiceClient } from "@/lib/supabase/server"
import { validateSeedArtists } from "@/lib/seed-artist-validation"
import { withAuthedCsrfRoute } from "@/lib/api/with-authed-route"
import { MAX_SEED_ARTISTS, seedCapError } from "@/lib/api/seed-cap"

// withAuthedCsrfRoute (not withAuthedJsonRoute): the invalid-body error here
// is "Invalid JSON body", matching /api/settings/seed-artists — not the
// wrapper's generic "Invalid JSON" — so body-parsing stays local.
export const POST = withAuthedCsrfRoute(async ({ userId, request }) => {
  let body: { artists?: unknown } | null
  try {
    body = await request.json()
  } catch {
    return apiError("Invalid JSON body", 400)
  }

  // `body?.`: a JSON `null` body parses fine and must 400, not throw.
  const result = validateSeedArtists(body?.artists, { min: 3, max: MAX_SEED_ARTISTS })
  if (!result.ok) return apiError(result.error, 400)

  const supabase = createServiceClient()

  const capped = await seedCapError(supabase, userId, result.artists, "onboarding/seeds/list")
  if (capped) return capped
  const rows = result.artists.map((a) => ({
    user_id: userId,
    artist_id: a.id,
    name: a.name,
    image_url: a.imageUrl,
  }))

  const { error } = await supabase
    .from("seed_artists")
    .upsert(rows, { onConflict: "user_id,artist_id" })

  if (error) {
    console.error("[onboarding/seeds] upsert error:", error.message)
    return apiError("Failed to save seed artists", 500)
  }

  return Response.json({ success: true })
})
