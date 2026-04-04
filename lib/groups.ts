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
