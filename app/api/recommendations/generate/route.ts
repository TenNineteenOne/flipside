import { auth } from "@/lib/auth"
import { createServiceClient } from "@/lib/supabase/server"
import { apiError, apiUnauthorized } from "@/lib/errors"
import { getAccessToken } from "@/lib/get-access-token"
import { getSpotifyClientToken } from "@/lib/spotify-client-token"
import { buildRecommendations } from "@/lib/recommendation/engine"
import { extractArtistColor } from "@/lib/colour-extraction"
import { searchTracksByArtist } from "@/lib/music-provider/itunes"
import { musicProvider } from "@/lib/music-provider/provider"
import { after, type NextRequest } from "next/server"
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
      try {
        results[i] = await tasks[i]()
      } catch (err) {
        console.error(`[pLimit] task ${i} failed:`, err instanceof Error ? err.message : err)
      }
    }
  })

  await Promise.all(workers)
  return results
}

type CachedRec = { spotify_artist_id: string; artist_data: unknown }
type SupabaseServiceClient = ReturnType<typeof createServiceClient>

async function runColorExtraction(
  supabase: SupabaseServiceClient,
  userId: string,
  cachedRecs: CachedRec[],
  artistIds: string[]
): Promise<void> {
  const { data: cacheRows } = await supabase
    .from("artist_search_cache")
    .select("spotify_artist_id, artist_color")
    .in("spotify_artist_id", artistIds)

  const colorMap = new Map<string, string | null>()
  for (const row of cacheRows ?? []) {
    colorMap.set(row.spotify_artist_id, row.artist_color ?? null)
  }

  const needsColor = cachedRecs.filter((r) => {
    const c = colorMap.get(r.spotify_artist_id)
    return !c || c.toLowerCase() === "#8b5cf6"
  })

  if (needsColor.length > 0) {
    const colorTasks = needsColor.map((r) => async () => {
      const artistData = r.artist_data as Artist | null
      const imageUrl = artistData?.imageUrl
      if (!imageUrl) return

      const color = await extractArtistColor(imageUrl)
      colorMap.set(r.spotify_artist_id, color)

      const { error: colorErr } = await supabase
        .from("artist_search_cache")
        .update({ artist_color: color })
        .eq("spotify_artist_id", r.spotify_artist_id)

      if (colorErr) {
        console.log(`[generate] color-update-fail id=${r.spotify_artist_id} err=${colorErr.message}`)
      }
    })
    await pLimit(colorTasks, 5)
  }

  await Promise.all(
    cachedRecs.map(async (r) => {
      const color = colorMap.get(r.spotify_artist_id)
      if (!color) return
      await supabase
        .from("recommendation_cache")
        .update({ artist_data: { ...(r.artist_data as object), artist_color: color } })
        .eq("user_id", userId)
        .eq("spotify_artist_id", r.spotify_artist_id)
    })
  )
}

async function runTrackPrewarm(
  supabase: SupabaseServiceClient,
  accessToken: string,
  cachedRecs: CachedRec[],
  artistIds: string[]
): Promise<void> {
  const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()

  const { data: freshTracks } = await supabase
    .from("artist_tracks_cache")
    .select("spotify_artist_id, fetched_at")
    .in("spotify_artist_id", artistIds)
    .gt("fetched_at", twentyFourHoursAgo)

  const freshTrackIds = new Set((freshTracks ?? []).map((r) => r.spotify_artist_id))

  // Pre-warm all 20 artists now that we're in after() and off the critical path.
  const staleArtists = cachedRecs.filter((r) => !freshTrackIds.has(r.spotify_artist_id))
  if (staleArtists.length === 0) return

  const tasks = staleArtists.map((r) => async () => {
    const artistData = r.artist_data as Artist | null
    const artistName = artistData?.name
    if (!artistName) return

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

export async function POST(req: NextRequest): Promise<Response> {
  console.log(`[generate] POST`)
  const session = await auth()
  if (!session?.user?.id) return apiUnauthorized()

  const userId = session.user.id

  // User-level Spotify token (only available for spotify_authorized users)
  const userAccessToken = await getAccessToken(req)

  const supabase = createServiceClient()

  // Read user row including play_threshold
  const { data: user, error: userError } = await supabase
    .from("users")
    .select("id, play_threshold, popularity_curve, underground_mode, deep_discovery, adventurous, last_generated_at")
    .eq("id", userId)
    .maybeSingle()

  if (userError || !user) return apiError("User not found", 404)

  // Default to 5 if the column is null (pre-migration rows)
  const playThreshold: number = user.play_threshold ?? 5
  // Default to 0.95 (legacy hardcoded value) for pre-migration rows
  const popularityCurve: number = user.popularity_curve ?? 0.95

  // Per-user cooldown: 30 seconds between generate requests
  if (user.last_generated_at) {
    const elapsed = Date.now() - new Date(user.last_generated_at).getTime()
    if (elapsed < 30_000) {
      return apiError("Please wait before generating more recommendations", 429)
    }
  }

  // Update cooldown timestamp
  await supabase.from("users").update({ last_generated_at: new Date().toISOString() }).eq("id", userId)

  // Replace mode: wipe unseen queue before regenerating. Powers the Settings
  // "Generate my feed" button so newly-added anchors take immediate effect.
  const replace = req.nextUrl.searchParams.get("replace") === "true"

  if (replace) {
    const { error: wipeErr } = await supabase
      .from("recommendation_cache")
      .delete()
      .eq("user_id", user.id)
      .is("seen_at", null)
    if (wipeErr) {
      console.error("[generate] replace wipe failed", wipeErr.message)
    }
  } else {
    // ── [SECURITY PATCH] Algorithmic Queue Capacity DoS limit ──
    // Restricts bad actors from infinitely looping the background engine, but allows up to 60 unseen artists to queue
    const { count, error: countErr } = await supabase
      .from("recommendation_cache")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id)
      .is("seen_at", null)

    if (countErr) {
      console.error("[generate] failed to check queue limit", countErr)
    }

    if (count && count >= 60) {
      return apiError("Your discovery queue is full. Please review some artists before generating more.", 429)
    }
  }

  try {
    // Note: For the normal append path, we no longer delete the unseen cache entries.
    // This allows users to request "more" natively and gracefully append them to their existing batch.
    // Replace mode (above) wipes unseen first so Settings-driven regen reflects new anchors.

    // Use user's Spotify token if available, otherwise fall back to client credentials
    const accessToken = userAccessToken ?? await getSpotifyClientToken() ?? ""

    // Optional genre filter from query params
    const rawGenre = req.nextUrl.searchParams.get("genre")
    const genre = rawGenre && rawGenre.length <= 80 ? rawGenre : undefined

    const { count: recCount, runSecondary, softenedFilters } = await buildRecommendations({
      userId: user.id,
      accessToken,
      playThreshold,
      popularityCurve,
      genre,
      undergroundMode: user.underground_mode ?? false,
      deepDiscovery: user.deep_discovery ?? false,
      adventurous: user.adventurous ?? false,
    })

    // Decorations (colour extraction + track pre-warming) and secondary
    // candidate resolution run AFTER the response returns so the feed
    // renders as soon as the initial cache is written. Cards degrade
    // gracefully: missing colours fall back to a deterministic name-hash
    // hue, missing tracks are fetched per-card on mount.
    after(async () => {
      // Run secondary resolution first so freshly-added rows get decorated
      // in the same background pass.
      if (runSecondary) {
        try {
          await runSecondary()
        } catch (err) {
          console.log(`[generate] secondary-fail err=${err instanceof Error ? err.message : err}`)
        }
      }

      const { data: cachedRecs } = await supabase
        .from("recommendation_cache")
        .select("spotify_artist_id, artist_data")
        .eq("user_id", user.id)
        .is("seen_at", null)

      if (!cachedRecs || cachedRecs.length === 0) return

      const artistIds = cachedRecs.map((r) => r.spotify_artist_id)

      await Promise.all([
        runColorExtraction(supabase, user.id, cachedRecs, artistIds),
        runTrackPrewarm(supabase, accessToken, cachedRecs, artistIds),
      ])
    })

    return Response.json({ success: true, count: recCount, softenedFilters })
  } catch (err) {
    console.log(`[generate] fail err=${err instanceof Error ? err.message : err}`)
    return apiError("Recommendation generation failed", 500)
  }
}
