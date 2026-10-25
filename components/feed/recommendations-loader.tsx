"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { Loader2, RefreshCw } from "lucide-react"
import { loaderAction, pollRecsUntilReady, postGenerate } from "@/lib/client/feed-generation"

/** Poll cadence + ceiling while a generation is in flight. */
const POLL_INTERVAL_MS = 2500
const POLL_MAX_MS = 30_000

export function RecommendationsLoader() {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let cancelled = false

    async function generate() {
      const result = await postGenerate()
      if (cancelled) return
      const next = loaderAction(result)
      if (next.action === "refresh") {
        router.refresh()
        return
      }
      if (next.action === "poll") {
        const outcome = await pollRecsUntilReady({
          deadline: Date.now() + POLL_MAX_MS,
          intervalMs: POLL_INTERVAL_MS,
          isCancelled: () => cancelled,
        })
        if (outcome === "ready") router.refresh()
        else if (outcome === "timeout") setError("Still working on your feed — refresh in a moment.")
        return
      }
      setError(next.message)
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
