import Link from "next/link"
import { redirect } from "next/navigation"
import { auth } from "@/lib/auth"
import { hasFreshRecs } from "@/lib/recommendation/freshness"
import { SplashClient } from "@/components/splash/splash-client"

export default async function LandingPage() {
  const session = await auth()

  if (session?.user?.id) {
    // Logged-in: if there are fresh recs waiting, skip straight to the feed
    if (await hasFreshRecs(session.user.id)) {
      redirect("/feed")
    }
    // Otherwise show the generation splash
    return <SplashClient />
  }

  // Logged-out → new discovery-engine splash
  return (
    <main
      style={{
        minHeight: "100dvh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "40px 24px",
        textAlign: "center",
        position: "relative",
        overflow: "hidden",
      }}
    >
      {/* Radial aura */}
      <div
        aria-hidden
        style={{
          position: "absolute",
          top: "30%",
          left: "50%",
          transform: "translate(-50%, -50%)",
          width: 600,
          height: 600,
          pointerEvents: "none",
          zIndex: -1,
          background: "radial-gradient(circle, var(--accent-glow) 0%, transparent 60%)",
        }}
      />

      {/* Brand mark */}
      <div style={{ display: "inline-flex", alignItems: "center", gap: 10, marginBottom: 32 }}>
        <span
          style={{
            width: 10,
            height: 10,
            borderRadius: "50%",
            background: "var(--accent)",
            boxShadow: "0 0 20px var(--accent-glow)",
          }}
        />
        <span className="display" style={{ fontSize: 18, letterSpacing: "-0.02em" }}>
          flipside
        </span>
      </div>

      {/* Headline */}
      <h1
        className="display"
        style={{
          fontSize: "clamp(44px, 9vw, 84px)",
          lineHeight: 0.95,
          margin: "0 0 18px",
          maxWidth: 680,
        }}
      >
        Music discovery,
        <br />
        <span className="serif" style={{ color: "var(--accent)", fontWeight: 400 }}>
          without the strings.
        </span>
      </h1>

      {/* Body copy */}
      <p
        className="muted"
        style={{ fontSize: 17, lineHeight: 1.5, maxWidth: 480, margin: "0 0 32px" }}
      >
        Pick a name. Tell us what you love — or don&apos;t.
        <br />
        We&apos;ll surface artists you&apos;ve probably never heard.
      </p>

      {/* CTA */}
      <Link
        href="/sign-in"
        className="btn btn-primary btn-lg"
        style={{ paddingLeft: 24, paddingRight: 24 }}
      >
        Start wandering →
      </Link>

      {/* Footer */}
      <div
        className="mono"
        style={{
          marginTop: 36,
          fontSize: 11,
          color: "var(--text-faint)",
          textTransform: "uppercase",
          letterSpacing: "0.16em",
        }}
      >
        no email · no password · no listening history
      </div>
    </main>
  )
}
