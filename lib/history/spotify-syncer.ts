import { createServiceClient } from "@/lib/supabase/server"
import { musicProvider } from "@/lib/music-provider/provider"

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
