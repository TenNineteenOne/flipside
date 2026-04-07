"use client"

import { useEffect } from "react"

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.log(`[error-boundary] global err="${error.message}" digest=${error.digest ?? "none"}`)
  }, [error])

  return (
    <html lang="en" className="h-full dark">
      <body className="min-h-full flex flex-col items-center justify-center gap-4 bg-black px-4 text-center text-white">
        <h2 className="text-lg font-semibold">Something went wrong</h2>
        <p className="max-w-md text-sm opacity-80 break-words">{error.message}</p>
        <button
          onClick={reset}
          className="rounded-md bg-white px-4 py-2 text-sm font-medium text-black transition-opacity hover:opacity-90"
        >
          Try again
        </button>
      </body>
    </html>
  )
}
