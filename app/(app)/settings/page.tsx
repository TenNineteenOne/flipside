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

  let lastfmArtistCount = 0
  if (user?.id && user?.lastfm_username) {
    const { count } = await supabase
      .from("listened_artists")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id)
      .eq("source", "lastfm")
    lastfmArtistCount = count ?? 0
  }

  return (
    <div
      style={{
        background: "var(--bg-base)",
        minHeight: "100vh",
        padding: "32px 16px",
      }}
    >
      <div style={{ maxWidth: 560, margin: "0 auto" }}>
        <h1
          style={{
            fontSize: 20,
            fontWeight: 700,
            color: "var(--text-primary)",
            marginBottom: 24,
          }}
        >
          Settings
        </h1>
        <SettingsForm
          displayName={user?.display_name ?? session.user.displayName ?? null}
          avatarUrl={user?.avatar_url ?? session.user.avatarUrl ?? null}
          initialPlayThreshold={user?.play_threshold ?? 5}
          initialLastfmUsername={user?.lastfm_username ?? null}
          initialLastfmArtistCount={lastfmArtistCount}
          flipsidePlaylistId={user?.flipside_playlist_id ?? null}
        />
      </div>
    </div>
  )
}
