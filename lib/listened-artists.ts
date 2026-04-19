import { createServiceClient } from "@/lib/supabase/server"
import { musicProvider } from "@/lib/music-provider/provider"
import { isRateLimited } from "@/lib/music-provider"

// Minimum name-similarity ratio (0–1) to accept a Spotify search result as a match.
// Uses Dice coefficient on character bigrams.
const SIMILARITY_THRESHOLD = 0.8

/** Dice-coefficient similarity between two strings (case-insensitive). */
function stringSimilarity(a: string, b: string): number {
  const normalize = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim()
  const na = normalize(a)
  const nb = normalize(b)
  if (na === nb) return 1
  if (na.length < 2 || nb.length < 2) return 0

  const bigrams = (s: string): Map<string, number> => {
    const m = new Map<string, number>()
    for (let i = 0; i < s.length - 1; i++) {
      const bg = s.slice(i, i + 2)
      m.set(bg, (m.get(bg) ?? 0) + 1)
    }
    return m
  }

  const ma = bigrams(na)
  const mb = bigrams(nb)
  let intersection = 0
  for (const [bg, count] of ma) {
    intersection += Math.min(count, mb.get(bg) ?? 0)
  }
  return (2 * intersection) / (na.length - 1 + (nb.length - 1))
}

const RESOLUTION_BATCH_SIZE = 10

// Normalize artist name for Last.fm matching (lowercase, strip punctuation, trim)
export function normalizeArtistName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^\w\s]/g, "")
    .trim()
}

// Accumulate Spotify top artists + recently played into listened_artists
export async function accumulateSpotifyHistory(params: {
  userId: string      // Supabase user UUID
  accessToken: string // Spotify access token
}): Promise<void> {
  const { userId, accessToken } = params
  const supabase = createServiceClient()

  // Fetch top artists for all three time ranges and recently played in parallel
  const [shortTerm, mediumTerm, longTerm, recentlyPlayed] = await Promise.all([
    musicProvider.getTopArtists(accessToken, "short_term"),
    musicProvider.getTopArtists(accessToken, "medium_term"),
    musicProvider.getTopArtists(accessToken, "long_term"),
    musicProvider.getRecentlyPlayed(accessToken),
  ])

  // Deduplicate top artists by ID (first occurrence wins for name)
  const topArtistIds = new Set<string>()
  for (const artist of [...shortTerm, ...mediumTerm, ...longTerm]) {
    topArtistIds.add(artist.id)
  }

  // Upsert top artists in batch
  await batchUpsertSpotifyArtists(supabase, userId, [...topArtistIds], "spotify_top")

  // Deduplicate recently played artists by ID
  const recentArtistIds = new Set<string>()
  for (const play of recentlyPlayed) {
    recentArtistIds.add(play.artistId)
  }

  // Upsert recently played artists in batch
  await batchUpsertSpotifyArtists(supabase, userId, [...recentArtistIds], "spotify_recent")
}

async function batchUpsertSpotifyArtists(
  supabase: ReturnType<typeof createServiceClient>,
  userId: string,
  spotifyArtistIds: string[],
  source: "spotify_top" | "spotify_recent"
): Promise<void> {
  if (spotifyArtistIds.length === 0) return

  const now = new Date().toISOString()

  // Batch SELECT: find all existing rows for these artist IDs
  const { data: existingRows, error: selectError } = await supabase
    .from("listened_artists")
    .select("id, spotify_artist_id, play_count")
    .eq("user_id", userId)
    .in("spotify_artist_id", spotifyArtistIds)

  if (selectError) {
    console.error("[accumulateSpotifyHistory] Batch select error:", selectError.message)
    return
  }

  const existingMap = new Map<string, { id: string; play_count: number }>()
  for (const row of existingRows ?? []) {
    if (row.spotify_artist_id) {
      existingMap.set(row.spotify_artist_id, { id: row.id, play_count: row.play_count })
    }
  }

  // Partition into new inserts vs existing updates
  const toInsert: Array<{
    user_id: string
    spotify_artist_id: string
    lastfm_artist_name: null
    source: string
    play_count: number
    last_seen_at: string
  }> = []

  const toUpdate: Array<{ id: string; play_count: number; last_seen_at: string }> = []

  for (const artistId of spotifyArtistIds) {
    const existing = existingMap.get(artistId)
    if (existing) {
      toUpdate.push({ id: existing.id, play_count: existing.play_count + 1, last_seen_at: now })
    } else {
      toInsert.push({
        user_id: userId,
        spotify_artist_id: artistId,
        lastfm_artist_name: null,
        source,
        play_count: 1,
        last_seen_at: now,
      })
    }
  }

  // Batch INSERT new rows
  if (toInsert.length > 0) {
    const { error: insertError } = await supabase
      .from("listened_artists")
      .insert(toInsert)
    if (insertError) {
      console.error("[accumulateSpotifyHistory] Batch insert error:", insertError.message)
    }
  }

  // Batch UPDATE existing rows (Supabase upsert with onConflict on id)
  if (toUpdate.length > 0) {
    const { error: updateError } = await supabase
      .from("listened_artists")
      .upsert(toUpdate, { onConflict: "id" })
    if (updateError) {
      console.error("[accumulateSpotifyHistory] Batch update error:", updateError.message)
    }
  }

  console.log(`[accumulateSpotifyHistory] batch source=${source} insert=${toInsert.length} update=${toUpdate.length}`)
}

// ── Last.fm → Spotify ID resolution ──────────────────────────────────────────

interface UnresolvedRow {
  id: string
  lastfm_artist_name: string
}

/**
 * For every listened_artists row belonging to `userId` that has
 * `spotify_artist_id IS NULL` and hasn't been attempted in the last 7 days,
 * try to resolve the Spotify ID via the artist_search_cache first, then via a
 * live Spotify artist search.
 *
 * - Cache hit  → write spotify_artist_id, update id_resolution_attempted_at
 * - Search hit → write spotify_artist_id, upsert artist_search_cache, update timestamp
 * - No match   → leave spotify_artist_id as null, update timestamp (retry after 7 days)
 *
 * Processed in batches of RESOLUTION_BATCH_SIZE to stay within Spotify rate limits.
 * Never throws — all errors are logged so the parent sync call is not disrupted.
 */
export async function resolveUnresolvedArtistIds(params: {
  supabase: ReturnType<typeof createServiceClient>
  userId: string
  accessToken: string
}): Promise<void> {
  const { supabase, userId, accessToken } = params

  // 1. Fetch unresolved rows for this user
  const { data: rows, error: fetchError } = await supabase
    .from("listened_artists")
    .select("id, lastfm_artist_name")
    .eq("user_id", userId)
    .is("spotify_artist_id", null)
    .not("lastfm_artist_name", "is", null)
    .or(
      "id_resolution_attempted_at.is.null,id_resolution_attempted_at.lt." +
        new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
    )

  if (fetchError) {
    console.error(
      "[resolveLastFmArtistIds] Failed to fetch unresolved rows:",
      fetchError.message
    )
    return
  }

  const unresolved = (rows ?? []) as UnresolvedRow[]
  if (unresolved.length === 0) return

  console.log(`[resolveLastFmArtistIds] Resolving ${unresolved.length} artist(s) for user ${userId}`)

  // 2. Process in batches
  for (let i = 0; i < unresolved.length; i += RESOLUTION_BATCH_SIZE) {
    const batch = unresolved.slice(i, i + RESOLUTION_BATCH_SIZE)
    await resolveLastFmBatch({ supabase, userId, accessToken, batch })
  }
}

/**
 * Try to set spotify_artist_id on `orphanId`. If a row with the same
 * (user_id, spotify_artist_id) already exists (unique constraint 23505),
 * merge the orphan's play_count into the existing row and delete the orphan.
 */
async function resolveOrMergeRow(params: {
  supabase: ReturnType<typeof createServiceClient>
  userId: string
  orphanId: string
  spotifyArtistId: string
  now: string
}): Promise<{ merged: boolean; error?: string }> {
  const { supabase, userId, orphanId, spotifyArtistId, now } = params

  const { error: updateErr } = await supabase
    .from("listened_artists")
    .update({ spotify_artist_id: spotifyArtistId, id_resolution_attempted_at: now })
    .eq("id", orphanId)

  if (!updateErr) return { merged: false }
  if (updateErr.code !== "23505") return { merged: false, error: updateErr.message }

  const { data: orphan } = await supabase
    .from("listened_artists")
    .select("play_count, last_seen_at")
    .eq("id", orphanId)
    .maybeSingle()

  const { data: target } = await supabase
    .from("listened_artists")
    .select("id, play_count, last_seen_at")
    .eq("user_id", userId)
    .eq("spotify_artist_id", spotifyArtistId)
    .maybeSingle()

  if (target && orphan) {
    const mergedPlays = (target.play_count ?? 0) + (orphan.play_count ?? 0)
    const mergedLastSeen =
      new Date(target.last_seen_at).getTime() >= new Date(orphan.last_seen_at).getTime()
        ? target.last_seen_at
        : orphan.last_seen_at
    await supabase
      .from("listened_artists")
      .update({ play_count: mergedPlays, last_seen_at: mergedLastSeen })
      .eq("id", target.id)
  }

  await supabase.from("listened_artists").delete().eq("id", orphanId)
  return { merged: true }
}

async function resolveLastFmBatch(params: {
  supabase: ReturnType<typeof createServiceClient>
  userId: string
  accessToken: string
  batch: UnresolvedRow[]
}): Promise<void> {
  const { supabase, userId, accessToken, batch } = params
  const now = new Date().toISOString()

  // 2a. Batch-read artist_search_cache for all names in this batch
  const nameLowers = batch.map((r) => r.lastfm_artist_name.toLowerCase())
  const { data: cacheRows, error: cacheErr } = await supabase
    .from("artist_search_cache")
    .select("name_lower, spotify_artist_id, artist_name, artist_data")
    .in("name_lower", nameLowers)

  if (cacheErr) {
    console.error(
      "[resolveLastFmArtistIds] Cache read error:",
      cacheErr.message
    )
    // Proceed without cache — will fall back to live search
  }

  type CacheRow = {
    name_lower: string
    spotify_artist_id: string
    artist_name: string
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    artist_data: any
  }
  const cacheByLower = new Map<string, CacheRow>()
  for (const row of (cacheRows ?? []) as CacheRow[]) {
    cacheByLower.set(row.name_lower, row)
  }

  for (const row of batch) {
    const nameLower = row.lastfm_artist_name.toLowerCase()
    const cached = cacheByLower.get(nameLower)

    if (cached) {
      // Cache hit — write spotify_artist_id back to listened_artists, merging
      // into an existing row for this user+artist if the unique constraint
      // (user_id, spotify_artist_id) trips.
      const res = await resolveOrMergeRow({
        supabase,
        userId,
        orphanId: row.id,
        spotifyArtistId: cached.spotify_artist_id,
        now,
      })
      if (res.error) {
        console.error(
          `[resolveLastFmArtistIds] Cache-hit update failed for "${row.lastfm_artist_name}":`,
          res.error
        )
      } else {
        console.log(
          `[resolveLastFmArtistIds] cache-hit name="${row.lastfm_artist_name}" id=${cached.spotify_artist_id}${res.merged ? " (merged)" : ""}`
        )
      }
      continue
    }

    // Cache miss — live Spotify search
    let resolvedId: string | null = null

    try {
      const results = await musicProvider.searchArtists(accessToken, row.lastfm_artist_name)

      if (isRateLimited(results)) {
        // Rate limited — skip this artist for now; retry next sync
        console.warn(
          `[resolveLastFmArtistIds] Rate limited searching "${row.lastfm_artist_name}", skipping`
        )
        // Update timestamp so we don't hammer Spotify again immediately
        await supabase
          .from("listened_artists")
          .update({ id_resolution_attempted_at: now })
          .eq("id", row.id)
        continue
      }

      if (results.length > 0) {
        // Find the best match by name similarity
        const nameLowerOrig = row.lastfm_artist_name.toLowerCase()
        const exactMatch = results.find(
          (a) => a.name.toLowerCase() === nameLowerOrig
        )
        const best = exactMatch ?? results[0]

        const similarity = stringSimilarity(row.lastfm_artist_name, best.name)
        if (similarity >= SIMILARITY_THRESHOLD) {
          resolvedId = best.id

          // Upsert artist_search_cache
          const { error: cacheWriteErr } = await supabase
            .from("artist_search_cache")
            .upsert(
              {
                name_lower: nameLowerOrig,
                spotify_artist_id: best.id,
                artist_name: best.name,
                artist_data: best,
              },
              { onConflict: "name_lower" }
            )

          if (cacheWriteErr) {
            console.error(
              `[resolveLastFmArtistIds] Cache write failed for "${row.lastfm_artist_name}":`,
              cacheWriteErr.message
            )
          }

          console.log(
            `[resolveLastFmArtistIds] resolved name="${row.lastfm_artist_name}" id=${best.id} sim=${similarity.toFixed(2)}`
          )
        } else {
          console.log(
            `[resolveLastFmArtistIds] low-similarity name="${row.lastfm_artist_name}" best="${best.name}" sim=${similarity.toFixed(2)} → unresolved`
          )
        }
      }
    } catch (err) {
      console.error(
        `[resolveLastFmArtistIds] Search threw for "${row.lastfm_artist_name}":`,
        err instanceof Error ? err.message : err
      )
    }

    // Write result (resolved ID or null) + update timestamp.
    // When resolvedId is set, the update may trip the (user_id, spotify_artist_id)
    // unique constraint if another source already owns that artist — merge in that case.
    if (resolvedId) {
      const res = await resolveOrMergeRow({
        supabase,
        userId,
        orphanId: row.id,
        spotifyArtistId: resolvedId,
        now,
      })
      if (res.error) {
        console.error(
          `[resolveLastFmArtistIds] Update failed for "${row.lastfm_artist_name}":`,
          res.error
        )
      } else if (res.merged) {
        console.log(
          `[resolveLastFmArtistIds] merged orphan name="${row.lastfm_artist_name}" into existing id=${resolvedId}`
        )
      }
    } else {
      const { error: updateErr } = await supabase
        .from("listened_artists")
        .update({
          spotify_artist_id: null,  // null stays null — retry via id_resolution_attempted_at window
          id_resolution_attempted_at: now,
        })
        .eq("id", row.id)

      if (updateErr) {
        console.error(
          `[resolveLastFmArtistIds] Timestamp update failed for "${row.lastfm_artist_name}":`,
          updateErr.message
        )
      }
    }
  }
}

interface LastFmTopArtist {
  name: string
  playcount: string
}

interface LastFmRecentTrack {
  artist: { "#text": string }
}

interface LastFmTopArtistsResponse {
  topartists?: { artist: LastFmTopArtist[] }
  error?: number
  message?: string
}

interface LastFmRecentTracksResponse {
  recenttracks?: { track: LastFmRecentTrack | LastFmRecentTrack[] }
  error?: number
  message?: string
}

// Accumulate Last.fm scrobble history into listened_artists
export async function accumulateLastFmHistory(params: {
  userId: string
  lastfmUsername: string
  /** Spotify access token — used for the ID resolution pass after upserting Last.fm rows. */
  accessToken: string
}): Promise<void> {
  const { userId, lastfmUsername, accessToken } = params
  const apiKey = process.env.LASTFM_API_KEY

  if (!apiKey) {
    throw new Error("Last.fm API key is not configured")
  }

  const baseUrl = "https://ws.audioscrobbler.com/2.0/"

  // Fetch top artists and recent tracks in parallel
  const [topArtistsRes, recentTracksRes] = await Promise.all([
    fetch(
      `${baseUrl}?method=user.getTopArtists&user=${encodeURIComponent(lastfmUsername)}&api_key=${apiKey}&format=json&limit=200`,
      { signal: AbortSignal.timeout(8000) }
    ),
    fetch(
      `${baseUrl}?method=user.getRecentTracks&user=${encodeURIComponent(lastfmUsername)}&api_key=${apiKey}&format=json&limit=200`,
      { signal: AbortSignal.timeout(8000) }
    ),
  ])

  if (!topArtistsRes.ok) {
    throw new Error(
      `Failed to fetch Last.fm top artists (HTTP ${topArtistsRes.status})`
    )
  }
  if (!recentTracksRes.ok) {
    throw new Error(
      `Failed to fetch Last.fm recent tracks (HTTP ${recentTracksRes.status})`
    )
  }

  const topArtistsData = (await topArtistsRes.json()) as LastFmTopArtistsResponse
  const recentTracksData =
    (await recentTracksRes.json()) as LastFmRecentTracksResponse

  if (topArtistsData.error) {
    throw new Error(
      topArtistsData.message ??
        `Last.fm error ${topArtistsData.error}: could not load top artists for "${lastfmUsername}"`
    )
  }
  if (recentTracksData.error) {
    throw new Error(
      recentTracksData.message ??
        `Last.fm error ${recentTracksData.error}: could not load recent tracks for "${lastfmUsername}"`
    )
  }

  // Collect all unique artist names
  const artistNames = new Set<string>()

  const topArtists = topArtistsData.topartists?.artist ?? []
  for (const artist of topArtists) {
    if (artist.name) {
      artistNames.add(artist.name)
    }
  }

  const rawTracks = recentTracksData.recenttracks?.track ?? []
  const recentTracks = Array.isArray(rawTracks) ? rawTracks : [rawTracks]
  for (const track of recentTracks) {
    const name = track.artist?.["#text"]
    if (name) {
      artistNames.add(name)
    }
  }

  const supabase = createServiceClient()

  // Batch upsert all Last.fm artists
  await batchUpsertLastFmArtists(supabase, userId, [...artistNames])

  // ── Resolution pass ────────────────────────────────────────────────────────
  // After upserting, attempt to resolve spotify_artist_id for any Last.fm rows
  // that still have NULL.  Runs non-blocking (no throw) so a Spotify hiccup
  // does not break the sync response for the user.
  try {
    await resolveUnresolvedArtistIds({ supabase, userId, accessToken })
  } catch (err) {
    console.error(
      "[accumulateLastFmHistory] Resolution pass failed:",
      err instanceof Error ? err.message : err
    )
  }
}

async function batchUpsertLastFmArtists(
  supabase: ReturnType<typeof createServiceClient>,
  userId: string,
  artistNames: string[]
): Promise<void> {
  if (artistNames.length === 0) return

  const now = new Date().toISOString()

  // Batch SELECT: find existing Last.fm rows (both resolved and unresolved)
  const { data: existingRows, error: selectError } = await supabase
    .from("listened_artists")
    .select("id, lastfm_artist_name, play_count")
    .eq("user_id", userId)
    .in("lastfm_artist_name", artistNames)

  if (selectError) {
    console.error("[accumulateLastFmHistory] Batch select error:", selectError.message)
    return
  }

  const existingMap = new Map<string, { id: string; play_count: number }>()
  for (const row of existingRows ?? []) {
    if (row.lastfm_artist_name) {
      existingMap.set(row.lastfm_artist_name, { id: row.id, play_count: row.play_count })
    }
  }

  const toInsert: Array<{
    user_id: string
    spotify_artist_id: null
    lastfm_artist_name: string
    source: string
    play_count: number
    last_seen_at: string
  }> = []

  const toUpdate: Array<{ id: string; play_count: number; last_seen_at: string }> = []

  for (const name of artistNames) {
    const existing = existingMap.get(name)
    if (existing) {
      toUpdate.push({ id: existing.id, play_count: existing.play_count + 1, last_seen_at: now })
    } else {
      toInsert.push({
        user_id: userId,
        spotify_artist_id: null,
        lastfm_artist_name: name,
        source: "lastfm",
        play_count: 1,
        last_seen_at: now,
      })
    }
  }

  if (toInsert.length > 0) {
    const { error: insertError } = await supabase
      .from("listened_artists")
      .insert(toInsert)
    if (insertError) {
      if (insertError.code === "23505") {
        // Concurrent sync from another source inserted a name-only row first.
        // Fall back to per-row insert so one conflict doesn't drop the batch.
        for (const row of toInsert) {
          const { error: rowErr } = await supabase.from("listened_artists").insert(row)
          if (rowErr && rowErr.code !== "23505") {
            console.error("[accumulateLastFmHistory] Row insert error:", rowErr.message)
          }
        }
      } else {
        console.error("[accumulateLastFmHistory] Batch insert error:", insertError.message)
      }
    }
  }

  if (toUpdate.length > 0) {
    const { error: updateError } = await supabase
      .from("listened_artists")
      .upsert(toUpdate, { onConflict: "id" })
    if (updateError) {
      console.error("[accumulateLastFmHistory] Batch update error:", updateError.message)
    }
  }

  console.log(`[accumulateLastFmHistory] batch insert=${toInsert.length} update=${toUpdate.length}`)
}
