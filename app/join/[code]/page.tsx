import { auth } from "@/lib/auth"
import { redirect } from "next/navigation"
import { cookies } from "next/headers"
import { createServiceClient } from "@/lib/supabase/server"
import { notFound } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Users } from "lucide-react"

interface JoinPageProps {
  params: Promise<{ code: string }>
}

export default async function JoinPage({ params }: JoinPageProps) {
  const { code } = await params
  const session = await auth()

  if (!session?.user?.spotifyId) {
    // Store invite code in cookie so we can process it after auth
    const cookieStore = await cookies()
    cookieStore.set("pending_invite", code, {
      path: "/",
      httpOnly: true,
      sameSite: "lax",
      maxAge: 60 * 30, // 30 minutes
    })
    redirect("/api/auth/signin")
  }

  // User is authenticated — look up the group by invite code
  const supabase = createServiceClient()

  const { data: group, error } = await supabase
    .from("groups")
    .select("id, name")
    .eq("invite_code", code)
    .single()

  if (error || !group) notFound()

  // Get member count
  const { count: memberCount } = await supabase
    .from("group_members")
    .select("id", { count: "exact", head: true })
    .eq("group_id", group.id)

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm rounded-xl border border-border bg-card p-8 text-center shadow-sm ring-1 ring-foreground/5">
        <div className="mb-4 flex justify-center">
          <div className="flex size-14 items-center justify-center rounded-full bg-primary/10 text-primary">
            <Users className="size-7" />
          </div>
        </div>

        <h1 className="mb-1 text-xl font-bold tracking-tight">
          You&apos;re invited!
        </h1>
        <p className="mb-1 text-base font-semibold text-primary">{group.name}</p>
        <p className="mb-6 text-sm text-muted-foreground">
          {memberCount ?? 0} {memberCount === 1 ? "member" : "members"}
        </p>

        {/* Join button — stub, full implementation in issue #25 */}
        <form
          action={async () => {
            "use server"
            // Full join logic lives in issue #25 (POST /api/groups/join)
            // For now redirect to groups list
            redirect("/groups")
          }}
        >
          <input type="hidden" name="code" value={code} />
          <Button type="submit" className="w-full">
            Join {group.name}
          </Button>
        </form>
      </div>
    </div>
  )
}
