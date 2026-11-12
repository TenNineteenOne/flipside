import { redirect } from "next/navigation"
import { safeAuth } from "@/lib/auth"
import { createServiceClient } from "@/lib/supabase/server"
import { getCachedUser } from "@/lib/user-cache"
import { SavedClient, type SavedArtistRow } from "@/components/saved/saved-client"
import { readAllRows } from "@/lib/recommendation/exclusions"
import { DEFAULT_MUSIC_PLATFORM, isMusicPlatform, type MusicPlatform } from "@/lib/music-links"

/** PostgREST encodes `.in()` into the URL: keep id lists well under the 414 limit (as /stats). */
const IN_CHUNK = 500

type ArtistMeta = {
  id: string
  spotify_id: string | null
  name: string
  genres: string[] | null
  image_url: string | null
  artist_color: string | null
}

export default async function SavedPage() {
  const session = await safeAuth()
  if (!session?.user?.id) {
    redirect("/sign-in")
  }

  const userId = session.user.id
  const supabase = createServiceClient()

  // Saves only need the session id: fetch them (every page: PostgREST caps a
  // read at 1000 rows) alongside the user row. Ordered by id for keyset paging,
  // re-sorted newest first below.
  const [user, saves] = await Promise.all([
    getCachedUser(userId),
    readAllRows<{ id: string; artist_id: string; artist_name: string | null; created_at: string }>(() =>
      supabase.from("saves").select("id, artist_id, artist_name, created_at").eq("user_id", userId),
    ),
  ])

  if (!user) redirect("/sign-in?reauth=1") // stale JWT, row gone: the proxy lets this through
  if (saves.error) throw new Error(`[saved-page] saves read failed: ${saves.error.message}`)

  const musicPlatform: MusicPlatform = isMusicPlatform(user.preferred_music_platform)
    ? user.preferred_music_platform
    : DEFAULT_MUSIC_PLATFORM

  const saveRows = saves.data.sort((a, b) => b.created_at.localeCompare(a.created_at))

  // Metadata from `artists` by id (#175, as /stats): recommendation_cache rows are
  // hard-deleted by the cron after ~33 days, which stripped art from older saves.
  // saves.artist_id references artists(id), so every save has a row.
  const artistsById = new Map<string, ArtistMeta>()
  const ids = saveRows.map((r) => r.artist_id)
  const reads = await Promise.all(
    Array.from({ length: Math.ceil(ids.length / IN_CHUNK) }, (_, i) =>
      supabase
        .from("artists")
        .select("id, spotify_id, name, genres, image_url, artist_color")
        .in("id", ids.slice(i * IN_CHUNK, (i + 1) * IN_CHUNK)),
    ),
  )
  for (const { data, error } of reads) {
    if (error) throw new Error(`[saved-page] artists read failed: ${error.message}`)
    for (const a of (data ?? []) as ArtistMeta[]) artistsById.set(a.id, a)
  }

  const artists: SavedArtistRow[] = saveRows.map((row) => {
    const a = artistsById.get(row.artist_id)
    return {
      artistId: row.artist_id,
      spotifyId: a?.spotify_id ?? null,
      name: a?.name ?? row.artist_name ?? row.artist_id,
      genres: a?.genres ?? [],
      imageUrl: a?.image_url ?? null,
      artistColor: a?.artist_color ?? null,
    }
  })

  return (
    <SavedClient
      artists={artists}
      musicPlatform={musicPlatform}
    />
  )
}
