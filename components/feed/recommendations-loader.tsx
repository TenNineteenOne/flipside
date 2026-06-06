"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { Loader2, RefreshCw } from "lucide-react"
import { classifyGenerateResponse } from "@/lib/recommendation/generate-response"

/** Poll cadence + ceiling while a generation is in flight. */
const POLL_INTERVAL_MS = 2500
const POLL_MAX_MS = 30_000

export function RecommendationsLoader() {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let cancelled = false

    /** Poll GET /api/recommendations until recs appear or the ceiling is hit. */
    async function pollUntilReady(deadline: number): Promise<void> {
      while (!cancelled && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS))
        if (cancelled) return
        const res = await fetch("/api/recommendations")
        if (!res.ok) continue
        const data = (await res.json().catch(() => ({}))) as { recommendations?: unknown[] }
        if ((data.recommendations?.length ?? 0) > 0) {
          if (!cancelled) router.refresh()
          return
        }
      }
      if (!cancelled) setError("Still working on your feed — refresh in a moment.")
    }

    async function generate() {
      try {
        const res = await fetch("/api/recommendations/generate", { method: "POST" })
        if (cancelled) return
        const data = (await res.json().catch(() => ({}))) as { count?: number; error?: string; pending?: boolean }
        const outcome = classifyGenerateResponse(res.status, data)

        if (outcome === "ready") {
          router.refresh()
          return
        }
        if (outcome === "in-flight") {
          await pollUntilReady(Date.now() + POLL_MAX_MS)
          return
        }
        // outcome === "error"
        if (res.ok && data.count === 0) {
          throw new Error("No new artists found. Your listening history may be filtering everything out — try raising your play threshold in Settings.")
        }
        throw new Error(data.error ?? "Generation failed")
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
