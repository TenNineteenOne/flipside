import { auth } from "@/lib/auth"
import { createServiceClient } from "@/lib/supabase/server"
import { apiError, apiUnauthorized, apiNotFound } from "@/lib/errors"
import { getUserId } from "@/lib/groups"

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth()
  if (!session?.user?.spotifyId) return apiUnauthorized()

  const userId = await getUserId(session.user.spotifyId)
  if (!userId) return apiUnauthorized()

  const { id: groupId } = await params

  const supabase = createServiceClient()

  // Verify the caller is a member
  const { data: membership, error: memberError } = await supabase
    .from("group_members")
    .select("id")
    .eq("group_id", groupId)
    .eq("user_id", userId)
    .single()

  if (memberError || !membership) return apiNotFound()

  // Fetch the group invite code
  const { data: group, error: groupError } = await supabase
    .from("groups")
    .select("invite_code")
    .eq("id", groupId)
    .single()

  if (groupError || !group) return apiNotFound()

  const inviteCode: string = group.invite_code
  const inviteUrl = `${process.env.NEXT_PUBLIC_APP_URL ?? ""}/join/${inviteCode}`

  return Response.json({ inviteCode, inviteUrl })
}
