import { signOut } from "@/lib/auth"
import { createServiceClient } from "@/lib/supabase/server"
import { apiError } from "@/lib/errors"
import { withAuthedCsrfRoute } from "@/lib/api/with-authed-route"

export const DELETE = withAuthedCsrfRoute(async ({ userId }): Promise<Response> => {
  const supabase = createServiceClient()

  // All child tables that reference users(id) have ON DELETE CASCADE, so deleting
  // the user row cascades to all data. (The only historical non-cascade FKs were
  // groups.created_by / group_activity.user_id, and those tables were removed in
  // migration 0010_remove_social_features — nothing left to block the delete.)
  const { error } = await supabase.from("users").delete().eq("id", userId)
  if (error) {
    console.error("[account/delete] failed:", error.message)
    return apiError("Failed to delete account", 500)
  }

  console.log(`[account/delete] deleted userId=${userId}`)

  // No redirect: fetch would replay the DELETE against "/" (405). The client navigates; this only clears the cookie.
  await signOut({ redirect: false })
  return Response.json({ success: true })
})
