import { auth } from "@/lib/auth"
import { redirect } from "next/navigation"
import { notFound } from "next/navigation"
import { createServiceClient } from "@/lib/supabase/server"
import { getUserId } from "@/lib/groups"
import { CopyInviteButton } from "@/components/groups/copy-invite-button"
import { LeaveGroupButton } from "@/components/groups/leave-group-button"
import { ArrowLeft } from "lucide-react"
import Link from "next/link"

interface GroupDetailPageProps {
  params: Promise<{ id: string }>
}

export default async function GroupDetailPage({ params }: GroupDetailPageProps) {
  const session = await auth()
  if (!session?.user?.spotifyId) redirect("/api/auth/signin")

  const userId = await getUserId(session.user.spotifyId)
  if (!userId) redirect("/api/auth/signin")

  const { id: groupId } = await params
  const supabase = createServiceClient()

  // Verify membership and fetch group
  const { data: group, error: groupError } = await supabase
    .from("groups")
    .select("id, name, invite_code")
    .eq("id", groupId)
    .single()

  if (groupError || !group) notFound()

  const { data: membership } = await supabase
    .from("group_members")
    .select("id")
    .eq("group_id", groupId)
    .eq("user_id", userId)
    .single()

  if (!membership) notFound()

  // Fetch members with user info
  const { data: memberRows } = await supabase
    .from("group_members")
    .select("users(id, display_name, avatar_url, spotify_id)")
    .eq("group_id", groupId)

  const members = (memberRows ?? [])
    .map((row: any) => row.users)
    .filter(Boolean)

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? ""
  const inviteUrl = `${appUrl}/join/${group.invite_code}`

  return (
    <div className="mx-auto max-w-2xl px-4 py-8">
      {/* Back link */}
      <Link
        href="/groups"
        className="mb-6 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" />
        All groups
      </Link>

      <h1 className="mb-6 text-2xl font-bold tracking-tight">{group.name}</h1>

      {/* Invite section */}
      <section className="mb-8 rounded-xl border border-border bg-muted/30 p-4">
        <p className="mb-3 text-sm font-medium">
          Share this link with friends
        </p>
        <div className="flex items-center gap-2">
          <code className="flex-1 truncate rounded-md bg-muted px-2 py-1.5 text-xs text-muted-foreground">
            {inviteUrl}
          </code>
          <CopyInviteButton inviteUrl={inviteUrl} />
        </div>
      </section>

      {/* Members section */}
      <section>
        <h2 className="mb-4 text-base font-semibold">
          Members ({members.length})
        </h2>
        <ul className="flex flex-col gap-3">
          {members.map((member: any) => (
            <li
              key={member.id}
              className="flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-3"
            >
              {/* Avatar */}
              {member.avatar_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={member.avatar_url}
                  alt={member.display_name ?? "Member"}
                  className="size-9 rounded-full object-cover ring-1 ring-border"
                />
              ) : (
                <div className="flex size-9 items-center justify-center rounded-full bg-primary/20 text-sm font-semibold text-primary ring-1 ring-primary/30">
                  {(member.display_name ?? "?").charAt(0).toUpperCase()}
                </div>
              )}
              <span className="text-sm font-medium">
                {member.display_name ?? member.spotify_id ?? "Unknown"}
              </span>
            </li>
          ))}
        </ul>
      </section>

      {/* Leave group */}
      <div className="mt-10 border-t border-border pt-6">
        <LeaveGroupButton groupId={group.id} />
      </div>
    </div>
  )
}
