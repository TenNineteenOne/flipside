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
  const userName = session?.user?.displayName ?? session?.user?.name ?? "User"
  const userImage = session?.user?.avatarUrl ?? session?.user?.image ?? null

  return (
    <AudioProvider>
      <div className="flex min-h-screen flex-col">
        <AppNav userName={userName} userImage={userImage} />
        {/* pb-16 on mobile to clear the fixed bottom nav */}
        <main className="flex-1 pb-16 md:pb-0">{children}</main>
        <MiniPlayer />
      </div>
    </AudioProvider>
  )
}
