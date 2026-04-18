import { auth } from "@/lib/auth"
import { AppNav } from "@/components/nav/app-nav"
import { AudioProvider } from "@/lib/audio-context"
import { MiniPlayer } from "@/components/player/mini-player"

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const session = await auth()
  // Seed the identicon from user ID (deterministic, not PII)
  const userSeed = session?.user?.id ?? session?.user?.name ?? "user"

  return (
    <AudioProvider>
      <div className="app">
        <AppNav userSeed={userSeed} />
        <main className="app-main">
          <div className="app-col">{children}</div>
        </main>
        <MiniPlayer />
      </div>
    </AudioProvider>
  )
}
