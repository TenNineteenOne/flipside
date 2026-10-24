import { createServiceClient } from "@/lib/supabase/server"
import { apiError } from "@/lib/errors"
import { withAuthedCsrfRoute } from "@/lib/api/with-authed-route"
import { getSpotifyClientToken } from "@/lib/spotify-client-token"
import { claimCooldown } from "@/lib/cooldown"
import { buildRecommendations } from "@/lib/recommendation/engine"
import { formatGenTiming } from "@/lib/recommendation/gen-timing"
import { resetCalls, snapshotCalls } from "@/lib/metrics/api-call-counter"
import { extractArtistColor } from "@/lib/colour-extraction"
import { after, type NextRequest } from "next/server"
import type { Artist } from "@/lib/music-provider/types"

// The blocking buildRecommendations() call plus after()'s background
// finish()/color-extraction work can run long; give it the full
// Hobby/Fluid function budget (F-hardening).
export const maxDuration = 300

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

type CachedRec = { artist_id: string; artist_data: unknown }
type SupabaseServiceClient = ReturnType<typeof createServiceClient>

async function runColorExtraction(
  supabase: SupabaseServiceClient,
  userId: string,
  cachedRecs: CachedRec[],
  artistIds: string[]
): Promise<void> {
  const { data: cacheRows } = await supabase
    .from("artists")
    .select("id, artist_color")
    .in("id", artistIds)

  const colorMap = new Map<string, string | null>()
  for (const row of cacheRows ?? []) {
    colorMap.set(row.id, row.artist_color ?? null)
  }

  const needsColor = cachedRecs.filter((r) => {
    const c = colorMap.get(r.artist_id)
    return !c || c.toLowerCase() === "#8b5cf6"
  })

  if (needsColor.length > 0) {
    const colorTasks = needsColor.map((r) => async () => {
      const artistData = r.artist_data as Artist | null
      const imageUrl = artistData?.imageUrl
      if (!imageUrl) return

      const color = await extractArtistColor(imageUrl)
      colorMap.set(r.artist_id, color)

      const { error: colorErr } = await supabase
        .from("artists")
        .update({ artist_color: color })
        .eq("id", r.artist_id)

      if (colorErr) {
        console.error(`[generate] color-update-fail id=${r.artist_id} err=${colorErr.message}`)
      }
    })
    await pLimit(colorTasks, 5)
  }

  await Promise.all(
    cachedRecs.map(async (r) => {
      const color = colorMap.get(r.artist_id)
      if (!color) return
      await supabase
        .from("recommendation_cache")
        .update({ artist_data: { ...(r.artist_data as object), artist_color: color } })
        .eq("user_id", userId)
        .eq("artist_id", r.artist_id)
    })
  )
}

export const POST = withAuthedCsrfRoute(async ({ userId, request }): Promise<Response> => {
  const req = request as NextRequest

  const supabase = createServiceClient()

  // Warm the Spotify client token concurrently with the user-row read. On
  // serverless cold starts the module-cached token is empty; overlapping it
  // with the DB round-trip removes a 200–400ms serial blip. The .catch settles
  // the promise so it never becomes an unhandled rejection if unused.
  const clientTokenPromise = getSpotifyClientToken().catch(() => null)

  // Read user row including play_threshold
  const { data: user, error: userError } = await supabase
    .from("users")
    .select("id, play_threshold, popularity_curve, underground_mode, deep_discovery, adventurous")
    .eq("id", userId)
    .maybeSingle()

  if (userError || !user) return apiError("User not found", 404)

  // Default to 5 if the column is null (pre-migration rows)
  const playThreshold: number = user.play_threshold ?? 5
  // Default to 0.95 (legacy hardcoded value) for pre-migration rows
  const popularityCurve: number = user.popularity_curve ?? 0.95

  // Replace mode: wipe unseen queue before regenerating. Powers the Settings
  // "Generate my feed" button so newly-added anchors take immediate effect.
  const replace = req.nextUrl.searchParams.get("replace") === "true"

  if (!replace) {
    // ── [SECURITY PATCH] Algorithmic Queue Capacity DoS limit ──
    // Restricts bad actors from infinitely looping the background engine, but allows up to 60 unseen artists to queue.
    // Counts only UNEXPIRED unseen rows — the same set the feed shows (feed-query,
    // hasFreshRecs); counting expired rows left returning users stuck at an empty
    // feed behind a "queue full" 429. Runs BEFORE the cooldown claim so a
    // queue-full 429 doesn't burn the 30s cooldown.
    const { count, error: countErr } = await supabase
      .from("recommendation_cache")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id)
      .is("seen_at", null)
      .gt("expires_at", new Date().toISOString())

    if (countErr) {
      console.error("[generate] failed to check queue limit", countErr)
    }

    if (count && count >= 60) {
      return apiError("Your discovery queue is full. Please review some artists before generating more.", 429)
    }
  }

  // Per-user cooldown: 30 seconds between generate requests (atomic claim —
  // stamps last_generated_at in the same statement that checks it).
  if ((await claimCooldown(supabase, userId, "last_generated_at", 30_000)) === "cooling") {
    return apiError("Please wait before generating more recommendations", 429)
  }

  if (replace) {
    const { error: wipeErr } = await supabase
      .from("recommendation_cache")
      .delete()
      .eq("user_id", user.id)
      .is("seen_at", null)
    if (wipeErr) {
      console.error("[generate] replace wipe failed", wipeErr.message)
    }
  }

  try {
    // Note: For the normal append path, we no longer delete the unseen cache entries.
    // This allows users to request "more" natively and gracefully append them to their existing batch.
    // Replace mode (above) wipes unseen first so Settings-driven regen reflects new anchors.

    // Spotify token is OPTIONAL (Stage 2 / #157): candidate resolution is now
    // Last.fm-based and previews fall back to iTunes, so generation runs fully
    // Spotify-free. Use a token when we have one (enables richer Spotify previews
    // via confirm), otherwise generate without it.
    // '' = no Spotify (the established RecommendationInput convention) — generation
    // runs Spotify-free (Last.fm resolver + iTunes previews).
    const accessToken = (await clientTokenPromise) ?? ""
    if (!accessToken) {
      console.log("[generate] no Spotify token — generating Spotify-free (Last.fm resolver + iTunes previews)")
    }

    // Optional genre filter from query params
    const rawGenre = req.nextUrl.searchParams.get("genre")
    const genre = rawGenre && rawGenre.length <= 80 ? rawGenre : undefined

    // Reset per-request API call counters before the blocking generate. The
    // snapshot below captures only the critical-path calls; background after()
    // work runs after logging and is intentionally excluded.
    resetCalls()
    const genStart = Date.now()
    const { count: recCount, pending, finish, softenedFilters, metrics } = await buildRecommendations({
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
      lastfmCalls: apiCalls.lastfm,
    }))

    // Colour extraction and secondary candidate resolution run AFTER the
    // response returns so the feed renders as soon as the initial cache is
    // written. Previews are now confirmed and baked into artist_data during
    // resolution (so there's no background track pre-warm — the old prewarm
    // raced the user and is gone). Missing colours fall back to a
    // deterministic name-hash hue.
    after(async () => {
      // One continuation: finish primary-to-20 (tier-2) and the secondary
      // pool (no-op when the pipeline failed early), then persist every
      // confirmed preview — across all soften runs — to artist_tracks_cache
      // (#162). The flush runs even when the secondary pass throws.
      try {
        await finish()
      } catch (err) {
        console.error(`[generate] background-fail err=${err instanceof Error ? err.message : err}`)
      }

      // Full-generation call counts (blocking + background). The [gen-timing]
      // log above snapshots only the blocking window; this exposes the true
      // per-gen iTunes/Spotify totals for the #162 measurement gate.
      const bgCalls = snapshotCalls()
      console.log(`[gen-timing-bg] itunesCalls=${bgCalls.itunes} spotifyCalls=${bgCalls.spotify} lastfmCalls=${bgCalls.lastfm.total}`)

      const { data: cachedRecs } = await supabase
        .from("recommendation_cache")
        .select("artist_id, artist_data")
        .eq("user_id", user.id)
        .is("seen_at", null)

      if (!cachedRecs || cachedRecs.length === 0) return

      const artistIds = cachedRecs.map((r) => r.artist_id)

      try {
        await runColorExtraction(supabase, user.id, cachedRecs, artistIds)
      } catch (err) {
        console.error("[generate] decoration-task failed", err)
      }
    })

    return Response.json({ success: true, count: recCount, softenedFilters, pending })
  } catch (err) {
    console.error(`[generate] fail err=${err instanceof Error ? err.message : err}`)
    return apiError("Recommendation generation failed", 500)
  }
})
