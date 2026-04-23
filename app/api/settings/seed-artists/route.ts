import { type NextRequest } from "next/server"
import { auth } from "@/lib/auth"
import { apiError, apiUnauthorized, dbError } from "@/lib/errors"
import { enforceSameOrigin } from "@/lib/csrf"
import { createServiceClient } from "@/lib/supabase/server"
import { isValidSpotifyId } from "@/lib/spotify-ids"
import { validateSeedArtists } from "@/lib/seed-artist-validation"
import { invalidateExploreCache } from "@/lib/recommendation/explore-engine"

const MAX_SEED_ARTISTS = 200

export async function GET() {
  const session = await auth()
  if (!session?.user?.id) return apiUnauthorized()

  const supabase = createServiceClient()
  const { data, error } = await supabase
    .from("seed_artists")
    .select("spotify_artist_id, name, image_url, added_at")
    .eq("user_id", session.user.id)
    .order("added_at", { ascending: true })

  if (error) return dbError(error, "settings/seed-artists/list")

  const artists = (data ?? []).map((r) => ({
    id: r.spotify_artist_id,
    name: r.name,
    imageUrl: r.image_url,
  }))
  return Response.json({ artists })
}

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

  const result = validateSeedArtists(body.artists, { min: 1, max: MAX_SEED_ARTISTS })
  if (!result.ok) return apiError(result.error, 400)

  const supabase = createServiceClient()

  const { data: existingRows, error: existingError } = await supabase
    .from("seed_artists")
    .select("spotify_artist_id")
    .eq("user_id", userId)

  if (existingError) return dbError(existingError, "settings/seed-artists/list")

  const existingIds = new Set((existingRows ?? []).map((r) => r.spotify_artist_id))
  const newIds = result.artists.filter((a) => !existingIds.has(a.id))
  if (existingIds.size + newIds.length > MAX_SEED_ARTISTS) {
    return apiError(`Cannot exceed ${MAX_SEED_ARTISTS} seed artists`, 400)
  }

  const rows = result.artists.map((a) => ({
    user_id: userId,
    spotify_artist_id: a.id,
    name: a.name,
    image_url: a.imageUrl,
  }))

  const { error } = await supabase
    .from("seed_artists")
    .upsert(rows, { onConflict: "user_id,spotify_artist_id" })

  if (error) return dbError(error, "settings/seed-artists/upsert")

  await invalidateExploreCache(userId).catch((err) => {
    console.error("[seed-artists] explore-invalidate failed", err)
  })

  return Response.json({ success: true })
}

export async function DELETE(req: NextRequest) {
  const blocked = enforceSameOrigin(req)
  if (blocked) return blocked
  const session = await auth()
  if (!session?.user?.id) return apiUnauthorized()

  const id = req.nextUrl.searchParams.get("id")
  if (!id || !isValidSpotifyId(id)) {
    return apiError("Valid Spotify artist id required", 400)
  }

  const supabase = createServiceClient()
  const { error } = await supabase
    .from("seed_artists")
    .delete()
    .eq("user_id", session.user.id)
    .eq("spotify_artist_id", id)

  if (error) return dbError(error, "settings/seed-artists/delete")

  await invalidateExploreCache(session.user.id).catch((err) => {
    console.error("[seed-artists] explore-invalidate failed", err)
  })

  return Response.json({ success: true })
}
