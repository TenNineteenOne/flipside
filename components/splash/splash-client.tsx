"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { Loader2, Sparkles } from "lucide-react"

type Status = "idle" | "generating" | "error"

const PROGRESS_STEPS = [
  "Reading your top artists…",
  "Finding similar artists…",
  "Loading your feed…",
]

export function SplashClient() {
  const router = useRouter()
  const [status, setStatus] = useState<Status>("idle")
  const [stepIndex, setStepIndex] = useState(0)

  // Cycle cosmetic progress copy while generating.
  useEffect(() => {
    if (status !== "generating") return
    setStepIndex(0)
    const id = setInterval(() => {
      setStepIndex((i) => Math.min(i + 1, PROGRESS_STEPS.length - 1))
    }, 2500)
    return () => clearInterval(id)
  }, [status])

  async function handleClick() {
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
    <main className="flex flex-col items-center justify-center min-h-screen px-6 text-center">
      <div className="max-w-md w-full space-y-8">
        <div className="space-y-3">
          <h1 className="text-5xl font-bold tracking-tight text-primary">flipside</h1>
          <p className="text-lg text-muted-foreground">
            Hand-picked underground artists, based on what you already love.
          </p>
        </div>

        {status === "idle" && (
          <div className="space-y-3">
            <button
              onClick={handleClick}
              className="inline-flex items-center justify-center gap-2 w-full h-12 px-6 rounded-lg bg-primary text-primary-foreground font-semibold text-sm transition-opacity hover:opacity-90"
            >
              <Sparkles className="size-4" />
              Find me music
            </button>
            <p className="text-xs text-muted-foreground">
              We&apos;ll read your Spotify listening history and find a fresh
              batch of artists you probably haven&apos;t heard.
            </p>
          </div>
        )}

        {status === "generating" && (
          <div className="space-y-3">
            <div className="flex items-center justify-center gap-2 text-sm text-foreground">
              <Loader2 className="size-4 animate-spin" />
              <span>{PROGRESS_STEPS[stepIndex]}</span>
            </div>
            <p className="text-xs text-muted-foreground">
              This usually takes 10–20 seconds.
            </p>
          </div>
        )}

        {status === "error" && (
          <div className="space-y-3">
            <p className="text-sm text-destructive">
              Something went wrong finding your music.
            </p>
            <button
              onClick={handleClick}
              className="inline-flex items-center justify-center w-full h-11 px-6 rounded-lg border border-border bg-background text-foreground font-medium text-sm transition-colors hover:bg-muted"
            >
              Try again
            </button>
          </div>
        )}
      </div>
    </main>
  )
}
