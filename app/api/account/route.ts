import { auth, signOut } from "@/lib/auth"
import { createServiceClient } from "@/lib/supabase/server"
import { apiUnauthorized, apiError } from "@/lib/errors"

export async function DELETE(): Promise<Response> {
  const session = await auth()
  if (!session?.user?.id) return apiUnauthorized()

  const userId = session.user.id
  const supabase = createServiceClient()

  // Delete all user data in dependency order
  await Promise.all([
    supabase.from("recommendation_cache").delete().eq("user_id", userId),
    supabase.from("feedback").delete().eq("user_id", userId),
    supabase.from("saves").delete().eq("user_id", userId),
    supabase.from("listened_artists").delete().eq("user_id", userId),
    supabase.from("seed_artists").delete().eq("user_id", userId),
  ])

  const { error } = await supabase.from("users").delete().eq("id", userId)
  if (error) {
    console.error("[account/delete] failed:", error.message)
    return apiError("Failed to delete account", 500)
  }

  console.log(`[account/delete] deleted userId=${userId}`)

  try {
    await signOut({ redirectTo: "/" })
  } catch (err: unknown) {
    const digest = (err as { digest?: string })?.digest ?? ""
    if (digest.startsWith("NEXT_REDIRECT")) throw err
  }

  return new Response(null, { status: 204 })
}
