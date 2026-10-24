import { apiError, dbError } from "@/lib/errors"
import { createServiceClient } from "@/lib/supabase/server"
import { isValidArtistId } from "@/lib/spotify-ids"
import { validateSeedArtists } from "@/lib/seed-artist-validation"
import { onTasteChanged } from "@/lib/taste-change"
import { withAuthedRoute, withAuthedCsrfRoute } from "@/lib/api/with-authed-route"
import { MAX_SEED_ARTISTS, seedCapError } from "@/lib/api/seed-cap"

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
  let body: { artists?: unknown } | null
  try {
    body = await request.json()
  } catch {
    return apiError("Invalid JSON body", 400)
  }

  const result = validateSeedArtists(body?.artists, { min: 1, max: MAX_SEED_ARTISTS })
  if (!result.ok) return apiError(result.error, 400)

  const supabase = createServiceClient()

  const capped = await seedCapError(supabase, userId, result.artists, "settings/seed-artists/list")
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

  if (error) return dbError(error, "settings/seed-artists/upsert")

  await onTasteChanged(supabase, userId, { kind: "seeds" })

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

  await onTasteChanged(supabase, userId, { kind: "seeds" })

  return Response.json({ success: true })
})
