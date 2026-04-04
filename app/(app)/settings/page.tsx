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
    .select("id, display_name, avatar_url, play_threshold, lastfm_username, flipside_playlist_id")
    .eq("spotify_id", session.user.spotifyId)
    .maybeSingle()

  return (
    <div className="max-w-2xl mx-auto px-4 py-8">
      <h1 className="mb-6 text-xl font-bold">Settings</h1>
      <SettingsForm
        displayName={user?.display_name ?? session.user.displayName ?? null}
        avatarUrl={user?.avatar_url ?? session.user.avatarUrl ?? null}
        initialPlayThreshold={user?.play_threshold ?? 0}
        initialLastfmUsername={user?.lastfm_username ?? null}
        flipsidePlaylistId={user?.flipside_playlist_id ?? null}
      />
    </div>
  )
}
