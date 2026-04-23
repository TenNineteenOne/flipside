"use client"

import { useEffect, useRef } from "react"

const SKIP_KEY = "explore-warmed-at"
const SKIP_WINDOW_MS = 60_000

/**
 * Mounted inside the Feed tree. After the page has been visible for a beat,
 * fires a background GET to /api/explore/preload so the Explore page's rails
 * + artist hydration cache are warm before the user navigates. No-op if the
 * same client warmed it within the last minute (session-scoped guard).
 */
export function ExplorePrewarm() {
  const firedRef = useRef(false)

  useEffect(() => {
    if (firedRef.current) return
    firedRef.current = true

    try {
      const last = sessionStorage.getItem(SKIP_KEY)
      if (last && Date.now() - Number(last) < SKIP_WINDOW_MS) return
    } catch {
      // sessionStorage can throw in private mode; fall through and warm.
    }

    const warm = () => {
      fetch("/api/explore/preload", { credentials: "include" })
        .then((r) => {
          if (r.ok) {
            try {
              sessionStorage.setItem(SKIP_KEY, String(Date.now()))
            } catch {
              // ignore
            }
          }
        })
        .catch(() => {})
    }

    const idle = (window as unknown as {
      requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number
    }).requestIdleCallback
    if (typeof idle === "function") {
      idle(warm, { timeout: 1500 })
    } else {
      const t = setTimeout(warm, 600)
      return () => clearTimeout(t)
    }
  }, [])

  return null
}
