import { createServiceClient } from "@/lib/supabase/server"
import { resolveUnresolvedArtistIds } from "@/lib/history/id-resolver"

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

  // Batch SELECT: find existing Last.fm rows (both resolved and unresolved).
  // Chunk the IN-list so Last.fm lifetime imports (up to ~2000 names) don't
  // produce an oversized WHERE clause. Chunks run in parallel; errors from
  // any chunk abort the whole pass.
  const CHUNK = 500
  const existingRows: Array<{ id: string; lastfm_artist_name: string | null; play_count: number }> = []
  {
    const chunks: string[][] = []
    for (let i = 0; i < artistNames.length; i += CHUNK) {
      chunks.push(artistNames.slice(i, i + CHUNK))
    }
    const chunkResults = await Promise.all(
      chunks.map((chunk) =>
        supabase
          .from("listened_artists")
          .select("id, lastfm_artist_name, play_count")
          .eq("user_id", userId)
          .in("lastfm_artist_name", chunk)
      )
    )
    for (const { data, error } of chunkResults) {
      if (error) {
        console.error("[accumulateLastFmHistory] Batch select error:", error.message)
        return
      }
      if (data) existingRows.push(...data)
    }
  }

  const existingMap = new Map<string, { id: string; play_count: number }>()
  for (const row of existingRows ?? []) {
    if (row.lastfm_artist_name) {
      existingMap.set(row.lastfm_artist_name, { id: row.id, play_count: row.play_count })
    }
  }

  const toInsert: Array<{
    user_id: string
    artist_id: null
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
        artist_id: null,
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
