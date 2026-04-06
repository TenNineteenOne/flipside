import { redirect } from "next/navigation"
import Image from "next/image"
import { auth } from "@/lib/auth"
import { createServiceClient } from "@/lib/supabase/server"
import { Music, ExternalLink } from "lucide-react"

interface ArtistData {
  id: string
  name: string
  genres: string[]
  imageUrl: string | null
  popularity: number
  topTracks?: Array<{
    id: string
    name: string
    albumName: string
    albumImageUrl: string | null
  }>
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
    .select("spotify_artist_id, spotify_track_id, artist_name, created_at")
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
          {(saveRows ?? []).map((row: any) => {
            const artistId: string = row.spotify_artist_id
            const artist = cacheMap.get(artistId)
            const savedTrack = row.spotify_track_id
              ? artist?.topTracks?.find((t) => t.id === row.spotify_track_id) ?? null
              : null
            return (
              <div
                key={artistId}
                className="overflow-hidden rounded-xl border border-border bg-card"
              >
                {/* Artist row */}
                <div className="flex items-center gap-3 p-3">
                  <div className="relative size-14 shrink-0 overflow-hidden rounded-lg bg-muted">
                    {artist?.imageUrl ? (
                      <Image
                        src={artist.imageUrl}
                        alt={artist.name ?? artistId}
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

                {/* Saved track row (only when a specific track was saved) */}
                {savedTrack && (
                  <div className="flex items-center gap-2 border-t border-border px-3 py-2 pl-[calc(56px+24px)]">
                    {savedTrack.albumImageUrl && (
                      <div className="relative size-8 shrink-0 overflow-hidden rounded bg-muted">
                        <Image
                          src={savedTrack.albumImageUrl}
                          alt={savedTrack.albumName}
                          fill
                          className="object-cover"
                          sizes="32px"
                        />
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-medium text-foreground">{savedTrack.name}</p>
                      <p className="truncate text-xs text-muted-foreground">{savedTrack.albumName}</p>
                    </div>
                    <a
                      href={`https://open.spotify.com/track/${row.spotify_track_id}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="shrink-0 flex items-center gap-1 text-xs text-muted-foreground hover:text-primary transition-colors"
                    >
                      <ExternalLink className="size-3" />
                      Open in Spotify
                    </a>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
