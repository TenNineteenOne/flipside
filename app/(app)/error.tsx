"use client"

import { useEffect } from "react"
import { RefreshCw } from "lucide-react"

export default function AppSectionError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.log(`[error-boundary] (app) err="${error.message}" digest=${error.digest ?? "none"}`)
  }, [error])

  return (
    <div className="flex min-h-[80vh] flex-col items-center justify-center gap-4 px-4 text-center">
      <h2 className="text-lg font-semibold text-foreground">Something went wrong</h2>
      <p className="max-w-md text-sm text-muted-foreground break-words">{error.message}</p>
      <button
        onClick={reset}
        className="flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
      >
        <RefreshCw className="size-4" />
        Try again
      </button>
    </div>
  )
}
