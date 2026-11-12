"use client"

import { use, useState } from "react"
import { signIn } from "next-auth/react"
import { useRouter } from "next/navigation"
import {
  normalizeUsername,
  parseSignInMode,
  signInErrorMessage,
  SIGN_IN_GENERIC_ERROR,
  USERNAME_RULE,
  type SignInMode,
} from "@/lib/auth-sign-in"
import { Wordmark } from "@/components/shell/wordmark"
import { safeFrom } from "./safe-from"

function cleanUsernameInput(raw: unknown): string {
  return typeof raw === "string" ? raw.toLowerCase().replace(/[^a-z0-9._-]/g, "").slice(0, 30) : ""
}

const MODES: { mode: SignInMode; label: string }[] = [
  { mode: "existing", label: "Existing account" },
  { mode: "new", label: "New account" },
]

export default function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}) {
  const router = useRouter()
  // The landing CTA opens ?mode=new; anything else is Existing (never create by accident).
  const params = use(searchParams)
  const initialMode = parseSignInMode(params.mode)
  // Where the proxy sent a signed-out deep link from (?from=/settings); /feed otherwise.
  const destination = safeFrom(params.from)
  const [mode, setMode] = useState<SignInMode>(initialMode)
  // The landing Step 1 form passes the typed name along.
  const [username, setUsername] = useState(() => cleanUsernameInput(params.username))
  const [agreed, setAgreed] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const isNew = mode === "new"
  // New mode validates before submitting so the user sees the rule, not a generic error.
  const usernameInvalid = isNew && username.length > 0 && normalizeUsername(username) === null
  // The no-recovery acknowledgment only gates creating an account.
  const canSubmit = username.trim().length >= 2 && (agreed || !isNew) && !loading

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!canSubmit) return
    if (isNew && normalizeUsername(username) === null) {
      setError(USERNAME_RULE)
      return
    }

    setLoading(true)
    setError(null)

    let navigating = false
    try {
      const result = await signIn("credentials", {
        username: username.trim(),
        mode,
        redirect: false,
      })

      if (result?.error) {
        setError(signInErrorMessage(mode, result.code))
        return
      }

      // Straight to the destination (default /feed, whose server render sends a
      // not-yet-onboarded user to /onboarding), saving a round trip.
      // replace: Back must not return to the sign-in form (the proxy bounces it anyway).
      navigating = true
      // A new account always starts at /feed, which sends it through onboarding.
      router.replace(isNew ? "/feed" : destination)
    } catch {
      // signIn threw (network drop, iOS backgrounding)
      setError(SIGN_IN_GENERIC_ERROR)
    } finally {
      // Keep the spinner through a successful navigation; reset on any failure.
      if (!navigating) setLoading(false)
    }
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
          <div style={{ display: "flex", justifyContent: "center", marginBottom: 8 }}>
            <Wordmark />
          </div>
          <div className="serif" style={{ fontSize: 22, color: "var(--text-primary)", lineHeight: 1.3 }}>
            {isNew ? "Pick a name" : "Sign in"}
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
              disabled={loading}
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
              {" "}Your username is your only key. Forget it and the account is gone.
            </div>
          </div>
        )}

        {/* Form */}
        <form onSubmit={handleSubmit} className="col gap-12">
          <label htmlFor="username" className="sr-only">Username</label>
          <div className="field" style={{ height: 48 }}>
            <input
              id="username"
              name="username"
              type="text"
              placeholder="your-username"
              value={username}
              onChange={(e) => setUsername(cleanUsernameInput(e.target.value))}
              autoComplete="username"
              autoCapitalize="none"
              autoCorrect="off"
              autoFocus
              spellCheck={false}
              maxLength={30}
              aria-invalid={usernameInvalid || undefined}
              aria-describedby={isNew ? "username-rule" : undefined}
              style={{ fontSize: 16 }}
            />
          </div>
          {isNew && (
            <div
              id="username-rule"
              style={{ fontSize: 11.5, marginTop: -4, color: usernameInvalid ? "var(--dislike)" : "var(--text-muted)" }}
            >
              {USERNAME_RULE}
            </div>
          )}

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
              role="alert"
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
              ? (loading ? "Creating account…" : "Create account")
              : (loading ? "Signing in…" : "Sign in")}
          </button>
        </form>
      </div>
    </div>
  )
}
