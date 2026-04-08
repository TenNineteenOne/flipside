import Link from "next/link"
import { redirect } from "next/navigation"
import { auth } from "@/lib/auth"
import { getUserId } from "@/lib/user"
import { hasFreshRecs } from "@/lib/recommendation/freshness"
import { SplashClient } from "@/components/splash/splash-client"

export default async function LandingPage() {
  const session = await auth()

  // Logged-out → existing sign-in CTA
  if (!session?.user?.spotifyId) {
    return (
      <main className="flex flex-col items-center justify-center min-h-screen px-6 text-center">
        <div className="max-w-md w-full space-y-8">
          <div className="space-y-2">
            <h1 className="text-5xl font-bold tracking-tight text-primary">
              flipside
            </h1>
            <p className="text-lg text-muted-foreground">
              Discover music your friends are into.
            </p>
          </div>
          <div className="space-y-3">
            <Link
              href="/api/auth/signin"
              className="inline-flex items-center justify-center w-full h-11 px-6 rounded-lg bg-primary text-primary-foreground font-semibold text-sm transition-opacity hover:opacity-90"
            >
              Connect Spotify
            </Link>
            <p className="text-xs text-muted-foreground">
              A private feed for small groups. No algorithm, just friends.
            </p>
          </div>
        </div>
      </main>
    )
  }

  // Logged-in: if there are fresh recs waiting, skip the splash
  const userId = await getUserId(session.user.spotifyId)
  if (userId && (await hasFreshRecs(userId))) {
    redirect("/feed")
  }

  // Otherwise show the splash so generation is an intentional click
  return <SplashClient />
}
