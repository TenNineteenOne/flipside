"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { Loader2, RefreshCw } from "lucide-react"

export function RecommendationsLoader() {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let cancelled = false

    async function generate() {
      try {
        const res = await fetch("/api/recommendations/generate", { method: "POST" })
        if (cancelled) return
        if (!res.ok) {
          const data = await res.json().catch(() => ({}))
          throw new Error((data as { error?: string }).error ?? "Generation failed")
        }
        const data = await res.json().catch(() => ({ count: -1 }))
        if (data.count === 0) {
          throw new Error("No new artists found. Your listening history may be filtering everything out — try raising your play threshold in Settings.")
        }
        router.refresh()
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load recommendations")
        }
      }
    }

    generate()
    return () => {
      cancelled = true
    }
  }, [router, attempt])

  if (error) {
    return (
      <div className="col" style={{ minHeight: "60vh", alignItems: "center", justifyContent: "center", gap: 16, padding: "0 16px", textAlign: "center" }}>
        <p style={{ fontSize: 14, color: "var(--dislike)" }}>{error}</p>
        <button
          className="btn"
          onClick={() => {
            setError(null)
            setAttempt((n) => n + 1)
          }}
          style={{ display: "flex", alignItems: "center", gap: 8 }}
        >
          <RefreshCw size={16} />
          Try again
        </button>
      </div>
    )
  }

  return (
    <div className="col" style={{ minHeight: "60vh", alignItems: "center", justifyContent: "center", gap: 16, padding: "0 16px", textAlign: "center" }}>
      <div style={{ width: 64, height: 64, display: "flex", alignItems: "center", justifyContent: "center", borderRadius: "50%", background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.08)" }}>
        <Loader2 size={32} className="animate-spin" style={{ color: "var(--accent)" }} />
      </div>
      <div className="col" style={{ gap: 6 }}>
        <p className="serif" style={{ fontSize: 18, fontWeight: 600 }}>Discovering music for you…</p>
        <p className="muted" style={{ fontSize: 14 }}>
          Building your discovery feed. This takes about 15 seconds on your first visit.
        </p>
      </div>
    </div>
  )
}
