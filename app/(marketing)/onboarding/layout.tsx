import { redirect } from "next/navigation"
import { safeAuth } from "@/lib/auth"
import { getCachedUser } from "@/lib/user-cache"

/**
 * Server guard for the client onboarding page: a finished user (Back, or a typed
 * URL) goes to /feed, so resubmitting can't overwrite their platform or genres.
 */
export default async function OnboardingLayout({ children }: { children: React.ReactNode }) {
  const session = await safeAuth()
  if (!session?.user?.id) redirect("/sign-in")
  const user = await getCachedUser(session.user.id)
  if (!user) redirect("/sign-in?reauth=1") // stale JWT, row gone
  if (user.onboarding_completed_at) redirect("/feed")
  return children
}
