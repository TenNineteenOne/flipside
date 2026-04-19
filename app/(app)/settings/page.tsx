import { redirect } from "next/navigation"
import { auth } from "@/lib/auth"
import { createServiceClient } from "@/lib/supabase/server"
import { SettingsForm } from "@/components/settings/settings-form"

export default async function SettingsPage() {
  const session = await auth()
  if (!session?.user?.id) {
    redirect("/sign-in")
  }

  const userId = session.user.id
  const supabase = createServiceClient()
  const { data: user } = await supabase
    .from("users")
    .select("id, play_threshold, lastfm_username, statsfm_username, underground_mode, selected_genres")
    .eq("id", userId)
    .maybeSingle()

  let lastfmArtistCount = 0
  if (user?.id && user?.lastfm_username) {
    const { count } = await supabase
      .from("listened_artists")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id)
      .eq("source", "lastfm")
    lastfmArtistCount = count ?? 0
  }

  const { data: seedArtistsData } = await supabase
    .from("seed_artists")
    .select("spotify_artist_id, name, image_url, added_at")
    .eq("user_id", userId)
    .order("added_at", { ascending: true })

  const seedArtists = (seedArtistsData ?? []).map((r) => ({
    id: r.spotify_artist_id,
    name: r.name,
    genres: [] as string[],
    imageUrl: r.image_url,
    popularity: 0,
  }))

  return (
    <SettingsForm
      userSeed={userId}
      initialPlayThreshold={user?.play_threshold ?? 5}
      initialLastfmUsername={user?.lastfm_username ?? null}
      initialStatsfmUsername={user?.statsfm_username ?? null}
      initialLastfmArtistCount={lastfmArtistCount}
      initialUndergroundMode={user?.underground_mode ?? false}
      initialSelectedGenres={(user?.selected_genres as string[] | null) ?? []}
      initialSeedArtists={seedArtists}
    />
  )
}
