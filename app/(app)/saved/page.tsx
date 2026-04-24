import { redirect } from "next/navigation"
import { auth } from "@/lib/auth"
import { createServiceClient } from "@/lib/supabase/server"
import { getCachedUser } from "@/lib/user-cache"
import { SavedClient, type SavedArtistRow } from "@/components/saved/saved-client"
import { DEFAULT_MUSIC_PLATFORM, isMusicPlatform, type MusicPlatform } from "@/lib/music-links"

export default async function SavedPage() {
  const session = await auth()
  if (!session?.user?.id) {
    redirect("/sign-in")
  }

  const userId = session.user.id
  const supabase = createServiceClient()

  const user = await getCachedUser(userId)

  if (!user) redirect("/sign-in")

  const hasLastfm = Boolean(user.lastfm_username)
  const musicPlatform: MusicPlatform = isMusicPlatform(user.preferred_music_platform)
    ? user.preferred_music_platform
    : DEFAULT_MUSIC_PLATFORM

  // Fetch saved rows (newest first)
  const { data: saveRows } = await supabase
    .from("saves")
    .select("spotify_artist_id, spotify_track_id, artist_name, created_at")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })

  const artistIds = (saveRows ?? []).map((r: { spotify_artist_id: string }) => r.spotify_artist_id)

  // Name fallback map from saves table (populated since migration 0003)
  const savedNameMap = new Map<string, string>(
    (saveRows ?? [])
      .filter((r: { artist_name?: string }) => r.artist_name)
      .map((r: { spotify_artist_id: string; artist_name: string }) => [r.spotify_artist_id, r.artist_name])
  )

  // Fetch richer artist data from recommendation_cache (best-effort)
  const cacheMap = new Map<string, Record<string, unknown>>()
  if (artistIds.length > 0) {
    const { data: cacheRows } = await supabase
      .from("recommendation_cache")
      .select("spotify_artist_id, artist_data")
      .eq("user_id", user.id)
      .in("spotify_artist_id", artistIds)

    for (const row of cacheRows ?? []) {
      if (row.artist_data) {
        cacheMap.set(row.spotify_artist_id, row.artist_data)
      }
    }
  }

  // Build artist rows for the Artists tab
  const artists: SavedArtistRow[] = (saveRows ?? []).map((row: { spotify_artist_id: string }) => {
    const artistId = row.spotify_artist_id
    const cached = cacheMap.get(artistId) as {
      name?: string;
      genres?: string[];
      imageUrl?: string;
      artist_color?: string;
    } | undefined

    return {
      artistId,
      name: cached?.name ?? savedNameMap.get(artistId) ?? artistId,
      genres: cached?.genres ?? [],
      imageUrl: cached?.imageUrl ?? null,
      artistColor: cached?.artist_color ?? "#8b5cf6",
    }
  })

  return (
    <SavedClient
      artists={artists}
      hasLastfm={hasLastfm}
      musicPlatform={musicPlatform}
    />
  )
}
