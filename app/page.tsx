import Link from "next/link";

export default function LandingPage() {
  return (
    <main className="flex flex-col items-center justify-center min-h-screen px-6 text-center">
      <div className="max-w-md w-full space-y-8">
        {/* Wordmark */}
        <div className="space-y-2">
          <h1 className="text-5xl font-bold tracking-tight text-primary">
            flipside
          </h1>
          <p className="text-lg text-muted-foreground">
            Discover music your friends are into.
          </p>
        </div>

        {/* CTA */}
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
  );
}
