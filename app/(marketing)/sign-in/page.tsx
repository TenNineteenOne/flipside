"use client"

import { useState } from "react"
import { signIn } from "next-auth/react"
import { useRouter } from "next/navigation"

export default function SignInPage() {
  const router = useRouter()
  const [username, setUsername] = useState("")
  const [agreed, setAgreed] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const canSubmit = username.trim().length >= 2 && agreed && !loading

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!canSubmit) return

    setLoading(true)
    setError(null)

    const result = await signIn("credentials", {
      username: username.trim(),
      redirect: false,
    })

    if (result?.error) {
      setError("Something went wrong. Please try again.")
      setLoading(false)
      return
    }

    // Check if new user needs onboarding
    try {
      const check = await fetch("/api/onboarding/check")
      if (check.ok) {
        const { needsOnboarding } = await check.json()
        if (needsOnboarding) {
          router.push("/onboarding")
          return
        }
      }
    } catch {
      // Fall through to feed on check failure
    }

    router.push("/feed")
  }

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "24px 16px",
      }}
    >
      {/* Ambient aura */}
      <div
        aria-hidden
        style={{
          position: "fixed",
          top: "30%",
          left: "50%",
          transform: "translate(-50%, -50%)",
          width: 500,
          height: 500,
          borderRadius: "50%",
          background: "radial-gradient(circle, rgba(139,92,246,0.18) 0%, transparent 70%)",
          pointerEvents: "none",
          zIndex: 0,
        }}
      />

      <div
        style={{
          position: "relative",
          zIndex: 1,
          width: "100%",
          maxWidth: 400,
        }}
      >
        {/* Brand */}
        <div style={{ marginBottom: 32, textAlign: "center" }}>
          <div
            className="topnav-brand"
            style={{ justifyContent: "center", marginBottom: 8 }}
          >
            <span className="dot" />
            flipside
          </div>
          <div className="serif" style={{ fontSize: 22, color: "var(--text-primary)", lineHeight: 1.3 }}>
            Pick a username.
            <br />
            That&rsquo;s it.
          </div>
        </div>

        {/* Warning card */}
        <div
          className="fs-card"
          style={{
            marginBottom: 20,
            borderColor: "rgba(139,92,246,0.25)",
            background: "rgba(139,92,246,0.06)",
          }}
        >
          <div style={{ fontSize: 12, lineHeight: 1.6, color: "var(--text-muted)" }}>
            <span style={{ color: "var(--accent)", fontWeight: 700 }}>No recovery.</span>
            {" "}Your username is your only key. If you forget it, your account is gone — there is no email, no password reset, and no way to recover it.
          </div>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="col gap-12">
          <div className="field" style={{ height: 48 }}>
            <input
              type="text"
              placeholder="your-username"
              value={username}
              onChange={(e) => setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9._-]/g, "").slice(0, 30))}
              autoComplete="username"
              autoFocus
              spellCheck={false}
              maxLength={30}
              style={{ fontSize: 16 }}
            />
          </div>

          {/* Acknowledgment */}
          <label
            style={{
              display: "flex",
              alignItems: "flex-start",
              gap: 10,
              cursor: "pointer",
              padding: "10px 14px",
              borderRadius: 10,
              background: agreed ? "rgba(139,92,246,0.08)" : "transparent",
              border: `1px solid ${agreed ? "rgba(139,92,246,0.3)" : "var(--border)"}`,
              transition: "all 0.15s",
            }}
          >
            <input
              type="checkbox"
              checked={agreed}
              onChange={(e) => setAgreed(e.target.checked)}
              style={{ marginTop: 2, flexShrink: 0, accentColor: "var(--accent)" }}
            />
            <span style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.5 }}>
              I understand my username cannot be recovered if I forget it.
            </span>
          </label>

          {error && (
            <div
              style={{
                fontSize: 12,
                color: "var(--dislike)",
                padding: "8px 12px",
                background: "rgba(255,75,75,0.08)",
                borderRadius: 8,
              }}
            >
              {error}
            </div>
          )}

          <button
            type="submit"
            className="btn btn-primary btn-block"
            disabled={!canSubmit}
            style={{ height: 48, fontSize: 15 }}
          >
            {loading ? "Signing in…" : "Continue →"}
          </button>
        </form>

        {/* Footer */}
        <div
          className="mono"
          style={{
            marginTop: 24,
            textAlign: "center",
            fontSize: 10.5,
            color: "var(--text-faint)",
            lineHeight: 1.6,
          }}
        >
          no email · no password · no listening history
        </div>
      </div>
    </div>
  )
}
