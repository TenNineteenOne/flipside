"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"

type Status = "idle" | "generating" | "error"

const PROGRESS_STEPS = [
  "Finding similar artists…",
  "Scoring by obscurity…",
  "Loading your feed…",
]

export function SplashClient() {
  const router = useRouter()
  const [status, setStatus] = useState<Status>("idle")
  const [stepIndex, setStepIndex] = useState(0)

  useEffect(() => {
    if (status !== "generating") return
    setStepIndex(0)
    const id = setInterval(() => {
      setStepIndex((i) => Math.min(i + 1, PROGRESS_STEPS.length - 1))
    }, 2500)
    return () => clearInterval(id)
  }, [status])

  async function handleGenerate() {
    setStatus("generating")
    try {
      const res = await fetch("/api/recommendations/generate", { method: "POST" })
      if (!res.ok) throw new Error(`http_${res.status}`)
      router.push("/feed")
    } catch (err) {
      console.error("[splash] generate failed", err)
      setStatus("error")
    }
  }

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

      <p
        className="muted"
        style={{ fontSize: 17, lineHeight: 1.5, maxWidth: 480, margin: "0 0 32px" }}
      >
        Hand-picked underground artists, based on what you already love.
      </p>

      {status === "idle" && (
        <button
          onClick={handleGenerate}
          className="btn btn-primary btn-lg fadein"
          style={{ paddingLeft: 24, paddingRight: 24 }}
        >
          Find my music →
        </button>
      )}

      {status === "generating" && (
        <div className="fadein col" style={{ alignItems: "center", gap: 12 }}>
          <div
            className="mono"
            style={{ fontSize: 13, color: "var(--text-secondary)", letterSpacing: "0.02em" }}
          >
            {PROGRESS_STEPS[stepIndex]}
          </div>
          <div
            className="eyebrow"
            style={{ color: "var(--text-faint)" }}
          >
            usually 10–20 seconds
          </div>
        </div>
      )}

      {status === "error" && (
        <div className="fadein col" style={{ alignItems: "center", gap: 12 }}>
          <p style={{ fontSize: 14, color: "var(--dislike)" }}>
            Something went wrong. Check your connection and try again.
          </p>
          <button
            onClick={handleGenerate}
            className="btn btn-sm"
          >
            Try again
          </button>
        </div>
      )}

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
