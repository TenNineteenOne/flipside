import { auth, signOut } from "@/lib/auth"
import { createServiceClient } from "@/lib/supabase/server"
import { apiUnauthorized, apiError } from "@/lib/errors"

export async function DELETE(): Promise<Response> {
  const session = await auth()
  if (!session?.user?.id) return apiUnauthorized()

  const userId = session.user.id
  const supabase = createServiceClient()

  // All child tables have ON DELETE CASCADE — deleting the user row cascades to all data
  const { error } = await supabase.from("users").delete().eq("id", userId)
  if (error) {
    console.error("[account/delete] failed:", error.message)
    return apiError("Failed to delete account", 500)
  }

  console.log(`[account/delete] deleted userId=${userId}`)

  // signOut() throws NEXT_REDIRECT internally — let it propagate for the redirect to work.
  await signOut({ redirectTo: "/" })

  // Unreachable — signOut always throws NEXT_REDIRECT. Satisfies TypeScript return type.
  return new Response(null, { status: 204 })
}
