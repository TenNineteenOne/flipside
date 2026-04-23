import { redirect } from "next/navigation"
import { safeAuth } from "@/lib/auth"
import { createServiceClient } from "@/lib/supabase/server"
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

  const supabase = createServiceClient()
  const { data: userRow } = await supabase
    .from("users")
    .select("adventurous")
    .eq("id", session.user.id)
    .maybeSingle()
  const initialAdventurous = !!userRow?.adventurous

  return (
    <NavigationProgressProvider>
      <AudioProvider>
        <div className="app">
          <AppNav userSeed={userSeed} initialAdventurous={initialAdventurous} />
          <main className="app-main">
            <div className="app-col">{children}</div>
          </main>
          <MiniPlayer />
        </div>
      </AudioProvider>
    </NavigationProgressProvider>
  )
}
