import { notFound } from "next/navigation"
import { AppShell } from "@/components/shell/app-shell"
import { AudioProvider } from "@/lib/audio-context"
import { MiniPlayer } from "@/components/player/mini-player"
import { NavigationProgressProvider } from "@/components/nav/navigation-progress"
import { PREVIEW_USER_SEED } from "@/lib/dev-preview/fixtures"
import { FetchStub } from "./fetch-stub"

/**
 * Development-only preview harness: the real signed-in chrome (same providers
 * and shell as app/(app)/layout.tsx) with a fixed fake user and no auth or
 * database. Never ships: 404 in production.
 */
export default function DevPreviewLayout({ children }: { children: React.ReactNode }) {
  if (process.env.NODE_ENV === "production") notFound()

  return (
    <NavigationProgressProvider>
      <FetchStub />
      <AudioProvider>
        <AppShell userSeed={PREVIEW_USER_SEED} initialAdventurous={false} pathPrefix="/dev-preview">
          <div className="app-col">{children}</div>
        </AppShell>
        <MiniPlayer />
      </AudioProvider>
    </NavigationProgressProvider>
  )
}
