import { auth } from "@/lib/auth"
import { createServiceClient } from "@/lib/supabase/server"
import { apiError, apiUnauthorized } from "@/lib/errors"
import { getUserId } from "@/lib/groups"

export async function POST(request: Request): Promise<Response> {
  const session = await auth()
  if (!session?.user?.spotifyId) return apiUnauthorized()

  const userId = await getUserId(session.user.spotifyId)
  if (!userId) return apiUnauthorized()

  let body: { inviteCode?: string }
  try {
    body = await request.json()
  } catch {
    return apiError("Invalid JSON", 400)
  }

  const inviteCode = body.inviteCode?.trim()
  if (!inviteCode) return apiError("Invite code is required", 400)

  const supabase = createServiceClient()

  // Find the group
  const { data: group, error: groupError } = await supabase
    .from("groups")
    .select("id")
    .eq("invite_code", inviteCode)
    .maybeSingle()

  if (groupError) return apiError(groupError.message)
  if (!group) return apiError("Invalid invite code", 404)

  // Check group size (max 10 members)
  const { count, error: countError } = await supabase
    .from("group_members")
    .select("id", { count: "exact", head: true })
    .eq("group_id", group.id)

  if (countError) return apiError(countError.message)
  if ((count ?? 0) >= 10) return apiError("This group is full (max 10 members)", 400)

  // Upsert membership (idempotent)
  const { error: memberError } = await supabase
    .from("group_members")
    .upsert({ group_id: group.id, user_id: userId }, { onConflict: "group_id,user_id" })

  if (memberError) return apiError(memberError.message)

  return Response.json({ groupId: group.id }, { status: 200 })
}
