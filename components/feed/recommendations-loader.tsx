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
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 px-4 text-center">
        <p className="text-sm text-destructive">{error}</p>
        <button
          onClick={() => {
            setError(null)
            setAttempt((n) => n + 1)
          }}
          className="flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
        >
          <RefreshCw className="size-4" />
          Try again
        </button>
      </div>
    )
  }

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 px-4 text-center">
      <div className="flex size-16 items-center justify-center rounded-full bg-primary/10 ring-1 ring-primary/20">
        <Loader2 className="size-8 animate-spin text-primary" />
      </div>
      <div className="space-y-1.5">
        <p className="text-lg font-semibold text-foreground">Discovering music for you…</p>
        <p className="text-sm text-muted-foreground">
          Analyzing your Spotify history. This takes about 15 seconds on your first visit.
        </p>
      </div>
    </div>
  )
}
