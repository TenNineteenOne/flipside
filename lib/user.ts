import { createServiceClient } from "@/lib/supabase/server"

export async function getUserId(spotifyId: string): Promise<string | null> {
  const supabase = createServiceClient()

  const { data, error } = await supabase
    .from("users")
    .select("id")
    .eq("spotify_id", spotifyId)
    .single()

  if (error || !data) return null
  return data.id
}

// Called server-side after auth to ensure user row exists in Supabase
export async function upsertUser(params: {
  spotifyId: string
  displayName: string | null
  avatarUrl: string | null
}): Promise<void> {
  const supabase = createServiceClient()

  const { error } = await supabase.from("users").upsert(
    {
      spotify_id: params.spotifyId,
      display_name: params.displayName,
      avatar_url: params.avatarUrl,
    },
    {
      onConflict: "spotify_id",
      ignoreDuplicates: true, // never overwrite play_threshold or flipside_playlist_id on re-login
    }
  )

  if (error) {
    console.error("[upsertUser] Supabase error:", error.message)
    throw new Error(`Failed to upsert user: ${error.message}`)
  }
}
