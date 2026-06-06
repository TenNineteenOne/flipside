import { auth } from "@/lib/auth"
import { createServiceClient } from "@/lib/supabase/server"
import { apiError, apiUnauthorized } from "@/lib/errors"
import { enforceSameOrigin } from "@/lib/csrf"
import { getAccessToken } from "@/lib/get-access-token"
import { getSpotifyClientToken } from "@/lib/spotify-client-token"
import { buildRecommendations } from "@/lib/recommendation/engine"
import { formatGenTiming } from "@/lib/recommendation/gen-timing"
import { resetCalls, snapshotCalls } from "@/lib/recommendation/api-call-counter"
import { extractArtistColor } from "@/lib/colour-extraction"
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
        console.error(`[generate] color-update-fail id=${r.spotify_artist_id} err=${colorErr.message}`)
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

export async function POST(req: NextRequest): Promise<Response> {
  const blocked = enforceSameOrigin(req)
  if (blocked) return blocked
  const session = await auth()
  if (!session?.user?.id) return apiUnauthorized()

  const userId = session.user.id

  // User-level Spotify token (only available for spotify_authorized users)
  const userAccessToken = await getAccessToken(req)

  const supabase = createServiceClient()

  // Warm the Spotify client token concurrently with the user-row read. On
  // serverless cold starts the module-cached token is empty; overlapping it
  // with the DB round-trip removes a 200–400ms serial blip. The .catch settles
  // the promise so it never becomes an unhandled rejection if unused.
  const clientTokenPromise = getSpotifyClientToken().catch(() => null)

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

    // Use user's Spotify token if available, otherwise fall back to client
    // credentials. Fail loudly if neither is available — silently passing an
    // empty bearer to Spotify would return 401 on every downstream call and
    // produce a batch of empty recommendations the client can't diagnose.
    const accessToken = userAccessToken ?? (await clientTokenPromise)
    if (!accessToken) {
      console.error("[generate] no Spotify token available (user + client credentials both failed)")
      return apiError("Music service temporarily unavailable", 503)
    }

    // Optional genre filter from query params
    const rawGenre = req.nextUrl.searchParams.get("genre")
    const genre = rawGenre && rawGenre.length <= 80 ? rawGenre : undefined

    // Reset per-request API call counters before the blocking generate. The
    // snapshot below captures only the critical-path calls; background after()
    // work runs after logging and is intentionally excluded.
    resetCalls()
    const genStart = Date.now()
    const { count: recCount, runSecondary, softenedFilters, metrics } = await buildRecommendations({
      userId: user.id,
      accessToken,
      playThreshold,
      popularityCurve,
      genre,
      undergroundMode: user.underground_mode ?? false,
      deepDiscovery: user.deep_discovery ?? false,
      adventurous: user.adventurous ?? false,
    })
    // Snapshot before logging — after() work runs after this point and is excluded.
    const apiCalls = snapshotCalls()
    console.log(formatGenTiming({
      userId: user.id,
      phases: { firstBatch: metrics.firstBatchMs, primary: metrics.primaryMs, preview: metrics.previewMs },
      totalMs: Date.now() - genStart,
      misses: metrics.misses,
      retries: metrics.retries,
      rateLimited: metrics.rateLimited,
      itunesCalls: apiCalls.itunes,
      spotifyCalls: apiCalls.spotify,
    }))

    // Colour extraction and secondary candidate resolution run AFTER the
    // response returns so the feed renders as soon as the initial cache is
    // written. Previews are now confirmed and baked into artist_data during
    // resolution (so there's no background track pre-warm — the old prewarm
    // raced the user and is gone). Missing colours fall back to a
    // deterministic name-hash hue.
    after(async () => {
      // Finish primary-to-20 (tier-2) then secondary pool in the background.
      // runSecondary handles both phases; it is null only when the pipeline
      // failed early (empty pool / no candidates).
      if (runSecondary) {
        try {
          await runSecondary()
        } catch (err) {
          console.error(`[generate] background-fail err=${err instanceof Error ? err.message : err}`)
        }
      }

      const { data: cachedRecs } = await supabase
        .from("recommendation_cache")
        .select("spotify_artist_id, artist_data")
        .eq("user_id", user.id)
        .is("seen_at", null)

      if (!cachedRecs || cachedRecs.length === 0) return

      const artistIds = cachedRecs.map((r) => r.spotify_artist_id)

      try {
        await runColorExtraction(supabase, user.id, cachedRecs, artistIds)
      } catch (err) {
        console.error("[generate] decoration-task failed", err)
      }
    })

    return Response.json({ success: true, count: recCount, softenedFilters, pending: runSecondary != null })
  } catch (err) {
    console.error(`[generate] fail err=${err instanceof Error ? err.message : err}`)
    return apiError("Recommendation generation failed", 500)
  }
}
