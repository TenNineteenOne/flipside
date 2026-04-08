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

  // Upsert top artists
  for (const spotifyArtistId of topArtistIds) {
    await upsertSpotifyArtist(supabase, userId, spotifyArtistId, "spotify_top")
  }

  // Deduplicate recently played artists by ID
  const recentArtistIds = new Set<string>()
  for (const play of recentlyPlayed) {
    recentArtistIds.add(play.artistId)
  }

  // Upsert recently played artists
  for (const spotifyArtistId of recentArtistIds) {
    await upsertSpotifyArtist(
      supabase,
      userId,
      spotifyArtistId,
      "spotify_recent"
    )
  }
}

async function upsertSpotifyArtist(
  supabase: ReturnType<typeof createServiceClient>,
  userId: string,
  spotifyArtistId: string,
  source: "spotify_top" | "spotify_recent"
): Promise<void> {
  // The unique constraint is (user_id, spotify_artist_id).
  // We use a raw SQL upsert via from().upsert() with ignoreDuplicates: false,
  // but the JS client can't increment on conflict — so we select first, then insert/update.
  const { data: existing, error: selectError } = await supabase
    .from("listened_artists")
    .select("id, play_count")
    .eq("user_id", userId)
    .eq("spotify_artist_id", spotifyArtistId)
    .maybeSingle()

  if (selectError) {
    console.error(
      "[accumulateSpotifyHistory] Select error for artist:",
      spotifyArtistId,
      selectError.message
    )
    return
  }

  if (existing) {
    const { error: updateError } = await supabase
      .from("listened_artists")
      .update({
        play_count: existing.play_count + 1,
        last_seen_at: new Date().toISOString(),
      })
      .eq("id", existing.id)

    if (updateError) {
      console.error(
        "[accumulateSpotifyHistory] Update error for artist:",
        spotifyArtistId,
        updateError.message
      )
    }
  } else {
    const { error: insertError } = await supabase
      .from("listened_artists")
      .insert({
        user_id: userId,
        spotify_artist_id: spotifyArtistId,
        lastfm_artist_name: null,
        source,
        play_count: 1,
        last_seen_at: new Date().toISOString(),
      })

    if (insertError) {
      console.error(
        "[accumulateSpotifyHistory] Insert error for artist:",
        spotifyArtistId,
        insertError.message
      )
    }
  }
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
 * - No match   → write sentinel 'NOT_FOUND', update timestamp (skipped for 7 days)
 *
 * Processed in batches of RESOLUTION_BATCH_SIZE to stay within Spotify rate limits.
 * Never throws — all errors are logged so the parent sync call is not disrupted.
 */
async function resolveLastFmArtistIds(params: {
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
    await resolveLastFmBatch({ supabase, accessToken, batch })
  }
}

async function resolveLastFmBatch(params: {
  supabase: ReturnType<typeof createServiceClient>
  accessToken: string
  batch: UnresolvedRow[]
}): Promise<void> {
  const { supabase, accessToken, batch } = params
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
      // Cache hit — write spotify_artist_id back to listened_artists
      const { error: updateErr } = await supabase
        .from("listened_artists")
        .update({
          spotify_artist_id: cached.spotify_artist_id,
          id_resolution_attempted_at: now,
        })
        .eq("id", row.id)

      if (updateErr) {
        console.error(
          `[resolveLastFmArtistIds] Cache-hit update failed for "${row.lastfm_artist_name}":`,
          updateErr.message
        )
      } else {
        console.log(
          `[resolveLastFmArtistIds] cache-hit name="${row.lastfm_artist_name}" id=${cached.spotify_artist_id}`
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
            `[resolveLastFmArtistIds] low-similarity name="${row.lastfm_artist_name}" best="${best.name}" sim=${similarity.toFixed(2)} → NOT_FOUND`
          )
        }
      }
    } catch (err) {
      console.error(
        `[resolveLastFmArtistIds] Search threw for "${row.lastfm_artist_name}":`,
        err instanceof Error ? err.message : err
      )
    }

    // Write result (resolved ID or NOT_FOUND sentinel) + update timestamp
    const { error: updateErr } = await supabase
      .from("listened_artists")
      .update({
        spotify_artist_id: resolvedId ?? "NOT_FOUND",
        id_resolution_attempted_at: now,
      })
      .eq("id", row.id)

    if (updateErr) {
      console.error(
        `[resolveLastFmArtistIds] Update failed for "${row.lastfm_artist_name}":`,
        updateErr.message
      )
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

  const baseUrl = "http://ws.audioscrobbler.com/2.0/"

  // Fetch top artists and recent tracks in parallel
  const [topArtistsRes, recentTracksRes] = await Promise.all([
    fetch(
      `${baseUrl}?method=user.getTopArtists&user=${encodeURIComponent(lastfmUsername)}&api_key=${apiKey}&format=json&limit=200`
    ),
    fetch(
      `${baseUrl}?method=user.getRecentTracks&user=${encodeURIComponent(lastfmUsername)}&api_key=${apiKey}&format=json&limit=200`
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

  // Upsert each artist — no unique constraint on (user_id, lastfm_artist_name),
  // so we do select-then-insert/update
  for (const artistName of artistNames) {
    await upsertLastFmArtist(supabase, userId, artistName)
  }

  // ── Resolution pass ────────────────────────────────────────────────────────
  // After upserting, attempt to resolve spotify_artist_id for any Last.fm rows
  // that still have NULL.  Runs non-blocking (no throw) so a Spotify hiccup
  // does not break the sync response for the user.
  try {
    await resolveLastFmArtistIds({ supabase, userId, accessToken })
  } catch (err) {
    console.error(
      "[accumulateLastFmHistory] Resolution pass failed:",
      err instanceof Error ? err.message : err
    )
  }
}

async function upsertLastFmArtist(
  supabase: ReturnType<typeof createServiceClient>,
  userId: string,
  artistName: string
): Promise<void> {
  const { data: existing, error: selectError } = await supabase
    .from("listened_artists")
    .select("id, play_count")
    .eq("user_id", userId)
    .eq("lastfm_artist_name", artistName)
    .is("spotify_artist_id", null)
    .maybeSingle()

  if (selectError) {
    console.error(
      "[accumulateLastFmHistory] Select error for artist:",
      artistName,
      selectError.message
    )
    return
  }

  if (existing) {
    const { error: updateError } = await supabase
      .from("listened_artists")
      .update({
        play_count: existing.play_count + 1,
        last_seen_at: new Date().toISOString(),
      })
      .eq("id", existing.id)

    if (updateError) {
      console.error(
        "[accumulateLastFmHistory] Update error for artist:",
        artistName,
        updateError.message
      )
    }
  } else {
    const { error: insertError } = await supabase
      .from("listened_artists")
      .insert({
        user_id: userId,
        spotify_artist_id: null,
        lastfm_artist_name: artistName,
        source: "lastfm",
        play_count: 1,
        last_seen_at: new Date().toISOString(),
      })

    if (insertError) {
      console.error(
        "[accumulateLastFmHistory] Insert error for artist:",
        artistName,
        insertError.message
      )
    }
  }
}
