import { apiError, dbError } from "@/lib/errors"
import { createServiceClient } from "@/lib/supabase/server"
import { isValidArtistId } from "@/lib/spotify-ids"
import { validateSeedArtists } from "@/lib/seed-artist-validation"
import { invalidateExploreCache } from "@/lib/recommendation/explore-engine"
import { withAuthedRoute, withAuthedCsrfRoute } from "@/lib/api/with-authed-route"

const MAX_SEED_ARTISTS = 200

export const GET = withAuthedRoute(async ({ userId }) => {
  const supabase = createServiceClient()
  const { data, error } = await supabase
    .from("seed_artists")
    .select("artist_id, name, image_url, added_at")
    .eq("user_id", userId)
    .order("added_at", { ascending: true })

  if (error) return dbError(error, "settings/seed-artists/list")

  const artists = (data ?? []).map((r) => ({
    id: r.artist_id,
    name: r.name,
    imageUrl: r.image_url,
  }))
  return Response.json({ artists })
})

// POST keeps body-parsing local (not withAuthedJsonRoute) so the invalid-body
// error message stays "Invalid JSON body", matching this route's prior
// behavior exactly — the wrapper's built-in body parser says "Invalid JSON".
export const POST = withAuthedCsrfRoute(async ({ userId, request }) => {
  let body: { artists?: unknown }
  try {
    body = await request.json()
  } catch {
    return apiError("Invalid JSON body", 400)
  }

  const result = validateSeedArtists(body.artists, { min: 1, max: MAX_SEED_ARTISTS })
  if (!result.ok) return apiError(result.error, 400)

  const supabase = createServiceClient()

  const { data: existingRows, error: existingError } = await supabase
    .from("seed_artists")
    .select("artist_id")
    .eq("user_id", userId)

  if (existingError) return dbError(existingError, "settings/seed-artists/list")

  const existingIds = new Set((existingRows ?? []).map((r) => r.artist_id))
  const newIds = result.artists.filter((a) => !existingIds.has(a.id))
  if (existingIds.size + newIds.length > MAX_SEED_ARTISTS) {
    return apiError(`Cannot exceed ${MAX_SEED_ARTISTS} seed artists`, 400)
  }

  const rows = result.artists.map((a) => ({
    user_id: userId,
    artist_id: a.id,
    name: a.name,
    image_url: a.imageUrl,
  }))

  const { error } = await supabase
    .from("seed_artists")
    .upsert(rows, { onConflict: "user_id,artist_id" })

  if (error) return dbError(error, "settings/seed-artists/upsert")

  await invalidateExploreCache(userId).catch((err) => {
    console.error("[seed-artists] explore-invalidate failed", err)
  })

  return Response.json({ success: true })
})

export const DELETE = withAuthedCsrfRoute(async ({ userId, request }) => {
  const id = new URL(request.url).searchParams.get("id")
  if (!id || !isValidArtistId(id)) {
    return apiError("Valid artist id (uuid) required", 400)
  }

  const supabase = createServiceClient()
  const { error } = await supabase
    .from("seed_artists")
    .delete()
    .eq("user_id", userId)
    .eq("artist_id", id)

  if (error) return dbError(error, "settings/seed-artists/delete")

  await invalidateExploreCache(userId).catch((err) => {
    console.error("[seed-artists] explore-invalidate failed", err)
  })

  return Response.json({ success: true })
})
