import { redirect } from "next/navigation"
import { safeAuth } from "@/lib/auth"
import { AppNav } from "@/components/nav/app-nav"
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

  return (
    <NavigationProgressProvider>
      <AudioProvider>
        <div className="app">
          <AppNav userSeed={userSeed} />
          <main className="app-main">
            <div className="app-col">{children}</div>
          </main>
          <MiniPlayer />
        </div>
      </AudioProvider>
    </NavigationProgressProvider>
  )
}
