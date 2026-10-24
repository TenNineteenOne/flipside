"use client"

import { useState } from "react"
import { signIn } from "next-auth/react"
import { useRouter } from "next/navigation"
import { SIGN_IN_CODES, type SignInMode } from "@/lib/auth-sign-in"

const MODES: { mode: SignInMode; label: string }[] = [
  { mode: "existing", label: "Existing account" },
  { mode: "new", label: "New account" },
]

// "Existing" failures stay generic: never reveal whether a username exists.
// "New" must say a name is taken; that's the accepted trade-off (#175 D3).
function errorMessage(mode: SignInMode, code: string | undefined): string {
  if (code === SIGN_IN_CODES.rateLimited) return "Too many attempts. Wait a minute and try again."
  if (code === SIGN_IN_CODES.taken) return "That username is taken. Pick another, or choose Existing account if it’s yours."
  if (code === SIGN_IN_CODES.failed && mode === "existing") return "Couldn’t sign in with that username."
  return "Something went wrong. Please try again."
}

export default function SignInPage() {
  const router = useRouter()
  const [mode, setMode] = useState<SignInMode>("existing")
  const [username, setUsername] = useState("")
  const [agreed, setAgreed] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const isNew = mode === "new"
  // The no-recovery acknowledgment only gates creating an account.
  const canSubmit = username.trim().length >= 2 && (agreed || !isNew) && !loading

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!canSubmit) return

    setLoading(true)
    setError(null)

    const result = await signIn("credentials", {
      username: username.trim(),
      mode,
      redirect: false,
    })

    if (result?.error) {
      setError(errorMessage(mode, result.code))
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
            className="appnav-brand"
            style={{ justifyContent: "center", marginBottom: 8 }}
          >
            <span className="dot" />
            <span className="wordmark">flipside</span>
          </div>
          <div className="serif" style={{ fontSize: 22, color: "var(--text-primary)", lineHeight: 1.3 }}>
            {isNew ? "Pick a username." : "Welcome back."}
            <br />
            {isNew ? <>That&rsquo;s it.</> : "Enter your username."}
          </div>
        </div>

        {/* Mode toggle */}
        <div role="group" aria-label="Account" style={{ display: "flex", gap: 8, marginBottom: 20 }}>
          {MODES.map((m) => (
            <button
              key={m.mode}
              type="button"
              className={`chip${mode === m.mode ? " selected" : ""}`}
              aria-pressed={mode === m.mode}
              onClick={() => {
                setMode(m.mode)
                setError(null)
              }}
              style={{ flex: 1, justifyContent: "center", height: 36 }}
            >
              {m.label}
            </button>
          ))}
        </div>

        {/* Warning card */}
        {isNew && (
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
        )}

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
          {isNew && (
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
          )}

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
            {isNew
              ? (loading ? "Creating account…" : "Create account →")
              : (loading ? "Signing in…" : "Sign in →")}
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
