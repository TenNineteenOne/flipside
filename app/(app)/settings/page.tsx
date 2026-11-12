import { redirect } from "next/navigation"
import { safeAuth } from "@/lib/auth"
import { createServiceClient } from "@/lib/supabase/server"
import { getCachedUser } from "@/lib/user-cache"
import { SettingsForm } from "@/components/settings/settings-form"
import { DEFAULT_MUSIC_PLATFORM, isMusicPlatform } from "@/lib/music-links"
import { decryptUsername } from "@/lib/crypto/username"
import { DEFAULT_FAME_LEVEL, isFameLevel } from "@/lib/settings/fame"

export default async function SettingsPage() {
  const session = await safeAuth()
  if (!session?.user?.id) {
    redirect("/sign-in")
  }

  const userId = session.user.id
  const supabase = createServiceClient()
  // Everything below keys off the session id, so all three reads run at once.
  // The Last.fm count is only used when the user row has a username.
  const [user, { count: lastfmCount }, { data: seedArtistsData }] = await Promise.all([
    getCachedUser(userId),
    supabase
      .from("listened_artists")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("source", "lastfm"),
    supabase
      .from("seed_artists")
      .select("artist_id, name, image_url")
      .eq("user_id", userId)
      .order("added_at", { ascending: true }),
  ])

  let lastfmUsername: string | null = null
  let statsfmUsername: string | null = null
  try {
    lastfmUsername = decryptUsername(user?.lastfm_username ?? null)
  } catch (err) {
    console.error(`[settings-page] lastfm decrypt failed userId=${userId} err="${err instanceof Error ? err.message : err}"`)
  }
  try {
    statsfmUsername = decryptUsername(user?.statsfm_username ?? null)
  } catch (err) {
    console.error(`[settings-page] statsfm decrypt failed userId=${userId} err="${err instanceof Error ? err.message : err}"`)
  }

  const lastfmArtistCount = user?.lastfm_username ? (lastfmCount ?? 0) : 0

  const seedArtists = (seedArtistsData ?? []).map((r) => ({
    id: r.artist_id,
    name: r.name,
    genres: [] as string[],
    imageUrl: r.image_url,
    popularity: 0,
  }))

  return (
    <SettingsForm
      userSeed={userId}
      initialFameLevel={isFameLevel(user?.fame_level) ? user.fame_level : DEFAULT_FAME_LEVEL}
      initialLastfmUsername={lastfmUsername}
      initialStatsfmUsername={statsfmUsername}
      initialLastfmArtistCount={lastfmArtistCount}
      initialSelectedGenres={(user?.selected_genres as string[] | null) ?? []}
      initialSeedArtists={seedArtists}
      initialMusicPlatform={
        isMusicPlatform(user?.preferred_music_platform)
          ? user.preferred_music_platform
          : DEFAULT_MUSIC_PLATFORM
      }
    />
  )
}
