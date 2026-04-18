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
    .select("id, play_threshold, lastfm_username, flipside_playlist_id")
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

  const userSeed = userId

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
