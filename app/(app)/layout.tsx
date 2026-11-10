import { redirect } from "next/navigation"
import { safeAuth } from "@/lib/auth"
import { getCachedUser } from "@/lib/user-cache"
import { AppShell } from "@/components/shell/app-shell"
import { AudioProvider } from "@/lib/audio-context"
import { MiniPlayer } from "@/components/player/mini-player"
import { NavigationProgressProvider } from "@/components/nav/navigation-progress"

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const session = await safeAuth()
  if (!session?.user?.id) redirect("/sign-in")

  // Seed the identicon from user ID (deterministic, not PII)
  const userSeed = session.user.id

  const userRow = await getCachedUser(session.user.id)
  const initialAdventurous = !!userRow?.adventurous

  return (
    <NavigationProgressProvider>
      <AudioProvider>
        <AppShell userSeed={userSeed} initialAdventurous={initialAdventurous}>
          <div className="app-col">{children}</div>
        </AppShell>
        <MiniPlayer />
      </AudioProvider>
    </NavigationProgressProvider>
  )
}
