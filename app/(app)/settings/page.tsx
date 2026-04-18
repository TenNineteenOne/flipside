import { redirect } from "next/navigation"
import { auth } from "@/lib/auth"
import { createServiceClient } from "@/lib/supabase/server"
import { SettingsForm } from "@/components/settings/settings-form"

export default async function SettingsPage() {
  const session = await auth()
  if (!session?.user?.spotifyId) {
    redirect("/api/auth/signin")
  }

  const supabase = createServiceClient()
  const { data: user } = await supabase
    .from("users")
    .select("id, play_threshold, lastfm_username, flipside_playlist_id")
    .eq("spotify_id", session.user.spotifyId)
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

  const userSeed = session.user.id ?? session.user.spotifyId ?? "user"

  return (
    <SettingsForm
      userSeed={userSeed}
      initialPlayThreshold={user?.play_threshold ?? 5}
      initialLastfmUsername={user?.lastfm_username ?? null}
      initialLastfmArtistCount={lastfmArtistCount}
      flipsidePlaylistId={user?.flipside_playlist_id ?? null}
    />
  )
}
