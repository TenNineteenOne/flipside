import { redirect } from "next/navigation"
import { auth } from "@/lib/auth"
import { createServiceClient } from "@/lib/supabase/server"
import { SavedClient, type SavedArtistRow, type SavedTrackRow } from "@/components/saved/saved-client"
import type { Track } from "@/lib/music-provider/types"

export default async function SavedPage() {
  const session = await auth()
  if (!session?.user?.spotifyId) {
    redirect("/api/auth/signin")
  }

  const supabase = createServiceClient()

  // Resolve internal user id + lastfm_username
  const { data: user } = await supabase
    .from("users")
    .select("id, lastfm_username")
    .eq("spotify_id", session.user.spotifyId)
    .single()

  if (!user) redirect("/api/auth/signin")

  const hasLastfm = Boolean(user.lastfm_username)

  // Fetch saved rows (newest first)
  const { data: saveRows } = await supabase
    .from("saves")
    .select("spotify_artist_id, spotify_track_id, artist_name, created_at")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })

  const artistIds = (saveRows ?? []).map((r: any) => r.spotify_artist_id)

  // Name fallback map from saves table (populated since migration 0003)
  const savedNameMap = new Map<string, string>(
    (saveRows ?? [])
      .filter((r: any) => r.artist_name)
      .map((r: any) => [r.spotify_artist_id, r.artist_name as string])
  )

  // Fetch richer artist data from recommendation_cache (best-effort)
  const cacheMap = new Map<string, any>()
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
  const artists: SavedArtistRow[] = (saveRows ?? []).map((row: any) => {
    const artistId: string = row.spotify_artist_id
    const cached = cacheMap.get(artistId)
    const topTracks: Track[] = (cached?.topTracks ?? []).map((t: any) => ({
      id: t.id ?? t.spotifyTrackId ?? "",
      spotifyTrackId: t.spotifyTrackId ?? null,
      name: t.name ?? "",
      previewUrl: t.previewUrl ?? null,
      durationMs: t.durationMs ?? 0,
      albumName: t.albumName ?? "",
      albumImageUrl: t.albumImageUrl ?? null,
      source: (t.source ?? "spotify") as Track["source"],
    }))

    return {
      artistId,
      name: cached?.name ?? savedNameMap.get(artistId) ?? artistId,
      genres: cached?.genres ?? [],
      imageUrl: cached?.imageUrl ?? null,
      artistColor: (cached as any)?.artist_color ?? "#8b5cf6",
      topTracks,
    }
  })

  // Build track rows for the Tracks tab
  // A track row exists when the save has a spotify_track_id
  const tracks: SavedTrackRow[] = (saveRows ?? [])
    .filter((r: any) => r.spotify_track_id)
    .map((row: any) => {
      const artistId: string = row.spotify_artist_id
      const cached = cacheMap.get(artistId)
      const matchedTrack = (cached?.topTracks ?? []).find(
        (t: any) => t.id === row.spotify_track_id || t.spotifyTrackId === row.spotify_track_id
      )
      return {
        id: row.spotify_track_id as string,
        name: matchedTrack?.name ?? "Unknown Track",
        artistName: cached?.name ?? savedNameMap.get(artistId) ?? artistId,
        albumImageUrl: matchedTrack?.albumImageUrl ?? null,
        durationMs: matchedTrack?.durationMs ?? 0,
      }
    })

  return (
    <SavedClient
      artists={artists}
      tracks={tracks}
      hasLastfm={hasLastfm}
    />
  )
}
