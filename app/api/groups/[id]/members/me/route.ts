import { auth } from "@/lib/auth"
import { createServiceClient } from "@/lib/supabase/server"
import { apiError, apiUnauthorized, apiNotFound } from "@/lib/errors"
import { getUserId } from "@/lib/groups"

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  const session = await auth()
  if (!session?.user?.spotifyId) return apiUnauthorized()

  const userId = await getUserId(session.user.spotifyId)
  if (!userId) return apiUnauthorized()

  const { id: groupId } = await params

  const supabase = createServiceClient()

  const { error } = await supabase
    .from("group_members")
    .delete()
    .eq("group_id", groupId)
    .eq("user_id", userId)

  if (error) return apiError(error.message)

  return new Response(null, { status: 204 })
}
