import { auth } from "@/lib/auth"
import { createServiceClient } from "@/lib/supabase/server"
import { apiError, apiUnauthorized, dbError } from "@/lib/errors"
import { getUserId } from "@/lib/groups"

export async function GET() {
  const session = await auth()
  if (!session?.user?.spotifyId) return apiUnauthorized()

  const userId = await getUserId(session.user.spotifyId)
  if (!userId) return apiUnauthorized()

  const supabase = createServiceClient()

  const { data, error } = await supabase
    .from("group_members")
    .select("groups(*)")
    .eq("user_id", userId)

  if (error) return dbError(error, "groups/list")

  const groups = (data ?? []).map((row: any) => row.groups).filter(Boolean)
  return Response.json({ groups })
}

export async function POST(request: Request) {
  const session = await auth()
  if (!session?.user?.spotifyId) return apiUnauthorized()

  const userId = await getUserId(session.user.spotifyId)
  if (!userId) return apiUnauthorized()

  let body: { name?: string }
  try {
    body = await request.json()
  } catch {
    return apiError("Invalid JSON", 400)
  }

  const name = body.name?.trim()
  if (!name) return apiError("Group name is required", 400)
  if (name.length > 100) return apiError("Group name must be 100 characters or less", 400)

  const supabase = createServiceClient()

  // Generate invite code
  const inviteCode = crypto.randomUUID().slice(0, 8)

  // Create group
  const { data: group, error: groupError } = await supabase
    .from("groups")
    .insert({ name, invite_code: inviteCode, created_by: userId })
    .select()
    .single()

  if (groupError) return dbError(groupError, "groups/create")

  // Add creator as first member
  const { error: memberError } = await supabase
    .from("group_members")
    .insert({ group_id: group.id, user_id: userId })

  if (memberError) {
    await supabase.from("groups").delete().eq("id", group.id)
    return dbError(memberError, "groups/add-creator")
  }

  const inviteUrl = `${process.env.NEXT_PUBLIC_APP_URL ?? ""}/join/${inviteCode}`

  return Response.json({ group: { ...group, inviteUrl } }, { status: 201 })
}
