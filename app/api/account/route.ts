import { signOut } from "@/lib/auth"
import { createServiceClient } from "@/lib/supabase/server"
import { apiError } from "@/lib/errors"
import { withAuthedCsrfRoute } from "@/lib/api/with-authed-route"

export const DELETE = withAuthedCsrfRoute(async ({ userId }): Promise<Response> => {
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
})
