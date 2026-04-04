import { auth } from "@/lib/auth"
import { redirect } from "next/navigation"
import { createServiceClient } from "@/lib/supabase/server"
import { getUserId } from "@/lib/groups"
import { CreateGroupDialog } from "@/components/groups/create-group-dialog"
import { GroupCard } from "@/components/groups/group-card"
import { Users } from "lucide-react"

export default async function GroupsPage() {
  const session = await auth()
  if (!session?.user?.spotifyId) redirect("/api/auth/signin")

  const userId = await getUserId(session.user.spotifyId)
  if (!userId) redirect("/api/auth/signin")

  const supabase = createServiceClient()

  const { data: memberRows } = await supabase
    .from("group_members")
    .select("groups(id, name, invite_code, created_at)")
    .eq("user_id", userId)

  // For each group, get the member count
  const groups = await Promise.all(
    (memberRows ?? [])
      .map((row: any) => row.groups)
      .filter(Boolean)
      .map(async (group: any) => {
        const { count } = await supabase
          .from("group_members")
          .select("id", { count: "exact", head: true })
          .eq("group_id", group.id)
        return { ...group, memberCount: count ?? 0 }
      })
  )

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? ""

  return (
    <div className="mx-auto max-w-2xl px-4 py-8">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">Groups</h1>
        <CreateGroupDialog />
      </div>

      {groups.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border py-16 text-center">
          <Users className="size-10 text-muted-foreground/50" />
          <p className="font-medium text-muted-foreground">No groups yet.</p>
          <p className="text-sm text-muted-foreground">
            Create one to get started.
          </p>
        </div>
      ) : (
        <ul className="flex flex-col gap-3">
          {groups.map((group) => (
            <li key={group.id}>
              <GroupCard
                id={group.id}
                name={group.name}
                memberCount={group.memberCount}
                inviteUrl={`${appUrl}/join/${group.invite_code}`}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
