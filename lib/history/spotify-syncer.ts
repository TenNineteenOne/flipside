import { createServiceClient } from "@/lib/supabase/server"
import { musicProvider } from "@/lib/music-provider/provider"
import { ensureArtists, type ArtistSeed, type ArtistsSupabaseClient } from "@/lib/artists"
import { upsertListenedArtists } from "@/lib/history/listened-upsert"

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

  // Mint/resolve each incoming Spotify id → canonical artists.id (uuid).
  const idMap = await ensureArtists(supabase as unknown as ArtistsSupabaseClient, seeds)
  const uuids = [...new Set([...idMap.values()])]
  if (uuids.length === 0) {
    console.log(`[accumulateSpotifyHistory] batch source=${source} no uuids minted`)
    return
  }

  await upsertListenedArtists({
    supabase,
    userId,
    keys: uuids,
    keyColumn: "artist_id",
    source,
    logPrefix: "[accumulateSpotifyHistory]",
    logLabel: `batch source=${source}`,
  })
}
