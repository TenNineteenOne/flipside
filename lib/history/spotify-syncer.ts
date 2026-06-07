import { createServiceClient } from "@/lib/supabase/server"
import { musicProvider } from "@/lib/music-provider/provider"
import { ensureArtists, type ArtistSeed, type ArtistsSupabaseClient } from "@/lib/artists"

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

  // Deduplicate top artists by Spotify id (first occurrence wins for name).
  const topSeeds = new Map<string, ArtistSeed>()
  for (const artist of [...shortTerm, ...mediumTerm, ...longTerm]) {
    if (artist.id && !topSeeds.has(artist.id)) {
      topSeeds.set(artist.id, { spotifyId: artist.id, name: artist.name })
    }
  }

  // Upsert top artists in batch
  await batchUpsertSpotifyArtists(supabase, userId, [...topSeeds.values()], "spotify_top")

  // Deduplicate recently played artists by Spotify id. Recent plays carry a
  // name too; use it, falling back to the id as a placeholder name.
  const recentSeeds = new Map<string, ArtistSeed>()
  for (const play of recentlyPlayed) {
    if (play.artistId && !recentSeeds.has(play.artistId)) {
      recentSeeds.set(play.artistId, {
        spotifyId: play.artistId,
        name: play.artistName || play.artistId,
      })
    }
  }

  // Upsert recently played artists in batch
  await batchUpsertSpotifyArtists(supabase, userId, [...recentSeeds.values()], "spotify_recent")
}

async function batchUpsertSpotifyArtists(
  supabase: ReturnType<typeof createServiceClient>,
  userId: string,
  seeds: ArtistSeed[],
  source: "spotify_top" | "spotify_recent"
): Promise<void> {
  if (seeds.length === 0) return

  const now = new Date().toISOString()

  // Mint/resolve each incoming Spotify id → canonical artists.id (uuid).
  const idMap = await ensureArtists(supabase as unknown as ArtistsSupabaseClient, seeds)
  const uuids = [...new Set([...idMap.values()])]
  if (uuids.length === 0) {
    console.log(`[accumulateSpotifyHistory] batch source=${source} no uuids minted`)
    return
  }

  // Batch SELECT: find all existing rows for these artist uuids
  const { data: existingRows, error: selectError } = await supabase
    .from("listened_artists")
    .select("id, artist_id, play_count")
    .eq("user_id", userId)
    .in("artist_id", uuids)

  if (selectError) {
    console.error("[accumulateSpotifyHistory] Batch select error:", selectError.message)
    return
  }

  const existingMap = new Map<string, { id: string; play_count: number }>()
  for (const row of existingRows ?? []) {
    if (row.artist_id) {
      existingMap.set(row.artist_id, { id: row.id, play_count: row.play_count })
    }
  }

  // Partition into new inserts vs existing updates
  const toInsert: Array<{
    user_id: string
    artist_id: string
    lastfm_artist_name: null
    source: string
    play_count: number
    last_seen_at: string
  }> = []

  const toUpdate: Array<{ id: string; play_count: number; last_seen_at: string }> = []

  const seenUuids = new Set<string>()
  for (const seed of seeds) {
    const uuid = idMap.get(seed.spotifyId)
    if (!uuid || seenUuids.has(uuid)) continue
    seenUuids.add(uuid)
    const existing = existingMap.get(uuid)
    if (existing) {
      toUpdate.push({ id: existing.id, play_count: existing.play_count + 1, last_seen_at: now })
    } else {
      toInsert.push({
        user_id: userId,
        artist_id: uuid,
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
