import { auth } from "@/lib/auth"
import { createServiceClient } from "@/lib/supabase/server"
import { apiError, apiUnauthorized } from "@/lib/errors"
import { getAccessToken } from "@/lib/get-access-token"
import { buildRecommendations } from "@/lib/recommendation/engine"
import { extractArtistColor } from "@/lib/colour-extraction"
import { searchTracksByArtist } from "@/lib/music-provider/itunes"
import { musicProvider } from "@/lib/music-provider/provider"
import { type NextRequest } from "next/server"
import type { Artist } from "@/lib/music-provider/types"

/** Run an array of async tasks with a maximum concurrency of `limit`. */
async function pLimit<T>(
  tasks: (() => Promise<T>)[],
  limit: number
): Promise<T[]> {
  const results: T[] = []
  let index = 0

  const workers = Array.from({ length: Math.min(limit, tasks.length) }, async () => {
    while (index < tasks.length) {
      const i = index++
      results[i] = await tasks[i]()
    }
  })

  await Promise.all(workers)
  return results
}

export async function POST(req: NextRequest): Promise<Response> {
  console.log(`[generate] POST`)
  const session = await auth()
  if (!session?.user?.spotifyId) return apiUnauthorized()

  const accessToken = await getAccessToken(req)
  if (!accessToken) return apiUnauthorized()

  const supabase = createServiceClient()

  // Read user row including play_threshold
  const { data: user, error: userError } = await supabase
    .from("users")
    .select("id, play_threshold")
    .eq("spotify_id", session.user.spotifyId)
    .maybeSingle()

  if (userError || !user) return apiError("User not found", 404)

  // Default to 5 if the column is null (pre-migration rows)
  const playThreshold: number = user.play_threshold ?? 5

  try {
    // Clear all unseen cache entries before regenerating
    const { error: deleteError } = await supabase
      .from("recommendation_cache")
      .delete()
      .eq("user_id", user.id)
      .is("seen_at", null)
    if (deleteError) console.log(`[generate] cache-delete err=${deleteError.message}`)

    const count = await buildRecommendations({
      userId: user.id,
      accessToken,
      spotifyId: session.user.spotifyId,
      playThreshold,
    })

    // ── Colour extraction ──────────────────────────────────────────────────
    // Fetch the ranked artists from recommendation_cache (just written).
    const { data: cachedRecs } = await supabase
      .from("recommendation_cache")
      .select("spotify_artist_id, artist_data")
      .eq("user_id", user.id)
      .is("seen_at", null)

    if (cachedRecs && cachedRecs.length > 0) {
      // Gather artist IDs so we can look up existing colours in batch.
      const artistIds = cachedRecs.map((r) => r.spotify_artist_id)

      const { data: cacheRows } = await supabase
        .from("artist_search_cache")
        .select("spotify_artist_id, artist_color")
        .in("spotify_artist_id", artistIds)

      const colorMap = new Map<string, string | null>()
      for (const row of cacheRows ?? []) {
        colorMap.set(row.spotify_artist_id, row.artist_color ?? null)
      }

      // Identify artists missing a colour.
      const needsColor = cachedRecs.filter(
        (r) => !colorMap.has(r.spotify_artist_id) || colorMap.get(r.spotify_artist_id) == null
      )

      if (needsColor.length > 0) {
        await Promise.all(
          needsColor.map(async (r) => {
            const artistData = r.artist_data as Artist | null
            const imageUrl = artistData?.imageUrl
            if (!imageUrl) return

            const color = await extractArtistColor(imageUrl)
            colorMap.set(r.spotify_artist_id, color)

            // Write back to artist_search_cache (keyed by spotify_artist_id)
            const { error: colorErr } = await supabase
              .from("artist_search_cache")
              .update({ artist_color: color })
              .eq("spotify_artist_id", r.spotify_artist_id)

            if (colorErr) {
              console.log(`[generate] color-update-fail id=${r.spotify_artist_id} err=${colorErr.message}`)
            }
          })
        )
      }

      // Write artist_color into recommendation_cache rows.
      await Promise.all(
        cachedRecs.map(async (r) => {
          const color = colorMap.get(r.spotify_artist_id)
          if (!color) return
          await supabase
            .from("recommendation_cache")
            .update({ artist_data: { ...(r.artist_data as object), artist_color: color } })
            .eq("user_id", user.id)
            .eq("spotify_artist_id", r.spotify_artist_id)
        })
      )

      // ── Track pre-warming ────────────────────────────────────────────────
      // For each ranked artist, ensure artist_tracks_cache has a fresh entry
      // (fetched within the last 24 hours). Fetch stale/missing with concurrency 5.
      const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()

      const { data: freshTracks } = await supabase
        .from("artist_tracks_cache")
        .select("spotify_artist_id, fetched_at")
        .in("spotify_artist_id", artistIds)
        .gt("fetched_at", twentyFourHoursAgo)

      const freshTrackIds = new Set((freshTracks ?? []).map((r) => r.spotify_artist_id))

      const staleArtists = cachedRecs.filter(
        (r) => !freshTrackIds.has(r.spotify_artist_id)
      ).slice(0, 8) // Limit to top 8 explicitly strictly to prevent Vercel Free-Tier 10s Serverless timeout

      if (staleArtists.length > 0) {
        const tasks = staleArtists.map((r) => async () => {
          const artistData = r.artist_data as Artist | null
          const artistName = artistData?.name
          if (!artistName) return

          // Try iTunes first (free, no auth)
          const itunesTracks = await searchTracksByArtist(artistName, "US", 5)
          if (itunesTracks && itunesTracks.length > 0) {
            await supabase.from("artist_tracks_cache").upsert(
              {
                spotify_artist_id: r.spotify_artist_id,
                tracks: itunesTracks,
                source: "itunes",
                fetched_at: new Date().toISOString(),
              },
              { onConflict: "spotify_artist_id" }
            )
            console.log(`[generate] prewarm-itunes artistId=${r.spotify_artist_id} count=${itunesTracks.length}`)
            return
          }

          // Fall back to Spotify
          try {
            const spotifyTracks = await musicProvider.getArtistTopTracks(
              accessToken,
              r.spotify_artist_id,
              5,
              "US"
            )
            if (spotifyTracks.length > 0) {
              await supabase.from("artist_tracks_cache").upsert(
                {
                  spotify_artist_id: r.spotify_artist_id,
                  tracks: spotifyTracks,
                  source: "spotify",
                  fetched_at: new Date().toISOString(),
                },
                { onConflict: "spotify_artist_id" }
              )
              console.log(`[generate] prewarm-spotify artistId=${r.spotify_artist_id} count=${spotifyTracks.length}`)
            }
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err)
            console.log(`[generate] prewarm-fail artistId=${r.spotify_artist_id} err="${msg}"`)
          }
        })

        await pLimit(tasks, 5)
      }
    }

    return Response.json({ success: true, count })
  } catch (err) {
    console.log(`[generate] fail err=${err instanceof Error ? err.message : err}`)
    return apiError("Recommendation generation failed", 500)
  }
}
