import { redirect } from "next/navigation"
import { preconnect } from "react-dom"
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

  // iTunes preview host: warm the TLS connection before the first play.
  // (Spotify preview_url is null for client-credentials apps, so p.scdn.co is skipped.)
  // Matches `new Audio(url)` (no crossOrigin) in lib/audio-context.
  preconnect("https://audio-ssl.itunes.apple.com")

  const userRow = await getCachedUser(session.user.id)
  // Stale JWT, row gone (deleted account): every (app) page needs the row. The proxy lets ?reauth=1 through.
  if (!userRow) redirect("/sign-in?reauth=1")
  const initialAdventurous = !!userRow.adventurous

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
