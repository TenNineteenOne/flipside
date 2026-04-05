import { redirect } from "next/navigation"
import Image from "next/image"
import { auth } from "@/lib/auth"
import { createServiceClient } from "@/lib/supabase/server"
import { Music } from "lucide-react"

interface ArtistData {
  id: string
  name: string
  genres: string[]
  imageUrl: string | null
  popularity: number
}

export default async function SavedPage() {
  const session = await auth()
  if (!session?.user?.spotifyId) {
    redirect("/api/auth/signin")
  }

  const supabase = createServiceClient()

  const { data: user } = await supabase
    .from("users")
    .select("id")
    .eq("spotify_id", session.user.spotifyId)
    .single()

  if (!user) redirect("/api/auth/signin")

  // Fetch saved artists (newest first)
  const { data: saveRows } = await supabase
    .from("saves")
    .select("spotify_artist_id, artist_name, created_at")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })

  const artistIds = (saveRows ?? []).map((r: any) => r.spotify_artist_id)
  // Build a name fallback from saves table (populated since migration 0003)
  const savedNameMap = new Map<string, string>(
    (saveRows ?? [])
      .filter((r: any) => r.artist_name)
      .map((r: any) => [r.spotify_artist_id, r.artist_name as string])
  )

  // Fetch richer artist data from cache (best-effort — may be missing)
  const cacheMap = new Map<string, ArtistData>()
  if (artistIds.length > 0) {
    const { data: cacheRows } = await supabase
      .from("recommendation_cache")
      .select("spotify_artist_id, artist_data")
      .eq("user_id", user.id)
      .in("spotify_artist_id", artistIds)

    for (const row of cacheRows ?? []) {
      if (row.artist_data) {
        cacheMap.set(row.spotify_artist_id, row.artist_data as ArtistData)
      }
    }
  }

  return (
    <div className="mx-auto w-full max-w-xl px-4 pt-6">
      <h1 className="mb-5 text-xl font-bold text-foreground">Saved Artists</h1>

      {artistIds.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 py-20 text-center">
          <p className="text-base font-medium text-foreground">No saved artists yet</p>
          <p className="text-sm text-muted-foreground">
            Save artists from your feed to find them here.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {artistIds.map((artistId) => {
            const artist = cacheMap.get(artistId)
            return (
              <div
                key={artistId}
                className="flex items-center gap-3 rounded-xl border border-border bg-card p-3"
              >
                {/* Artist image */}
                <div className="relative size-14 shrink-0 overflow-hidden rounded-lg bg-muted">
                  {artist?.imageUrl ? (
                    <Image
                      src={artist.imageUrl}
                      alt={artist.name}
                      fill
                      className="object-cover"
                      sizes="56px"
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center">
                      <Music className="size-6 text-muted-foreground/40" />
                    </div>
                  )}
                </div>

                {/* Artist info */}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-foreground">
                    {artist?.name ?? savedNameMap.get(artistId) ?? artistId}
                  </p>
                  {artist?.genres && artist.genres.length > 0 && (
                    <p className="truncate text-xs text-muted-foreground">
                      {artist.genres.slice(0, 3).join(" · ")}
                    </p>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
