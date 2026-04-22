"use client"

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
} from "react"
import { useLinkStatus } from "next/link"

type Ctx = {
  report: (id: string, pending: boolean) => void
}

const NavigationProgressContext = createContext<Ctx | null>(null)

type Phase = "idle" | "pending" | "done"

export function NavigationProgressProvider({
  children,
}: {
  children: React.ReactNode
}) {
  const pendingIds = useRef<Set<string>>(new Set())
  const [phase, setPhase] = useState<Phase>("idle")
  const doneTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const startTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const report = useCallback((id: string, pending: boolean) => {
    const had = pendingIds.current.has(id)
    if (pending === had) return
    if (pending) pendingIds.current.add(id)
    else pendingIds.current.delete(id)

    const anyPending = pendingIds.current.size > 0

    if (anyPending) {
      if (doneTimer.current) {
        clearTimeout(doneTimer.current)
        doneTimer.current = null
      }
      // Delay showing the bar for 100ms so fast transitions don't flash
      if (!startTimer.current) {
        startTimer.current = setTimeout(() => {
          startTimer.current = null
          if (pendingIds.current.size > 0) setPhase("pending")
        }, 100)
      }
    } else {
      if (startTimer.current) {
        clearTimeout(startTimer.current)
        startTimer.current = null
      }
      setPhase((prev) => (prev === "pending" ? "done" : "idle"))
      doneTimer.current = setTimeout(() => {
        doneTimer.current = null
        setPhase("idle")
      }, 400)
    }
  }, [])

  useEffect(() => {
    return () => {
      if (doneTimer.current) clearTimeout(doneTimer.current)
      if (startTimer.current) clearTimeout(startTimer.current)
    }
  }, [])

  return (
    <NavigationProgressContext.Provider value={{ report }}>
      <NavigationProgressBar phase={phase} />
      {children}
    </NavigationProgressContext.Provider>
  )
}

/**
 * Placed as a descendant of a <Link>. Reads useLinkStatus() and pushes
 * pending state up to the provider so a single top-of-screen bar reflects
 * whichever link is currently navigating.
 */
export function NavLinkStatus() {
  const { pending } = useLinkStatus()
  const ctx = useContext(NavigationProgressContext)
  const id = useId()

  useEffect(() => {
    ctx?.report(id, pending)
    return () => {
      ctx?.report(id, false)
    }
  }, [ctx, id, pending])

  return null
}

function NavigationProgressBar({ phase }: { phase: Phase }) {
  if (phase === "idle") return null
  return (
    <div
      aria-hidden
      className={
        phase === "pending" ? "nav-progress nav-progress-pending" : "nav-progress nav-progress-done"
      }
    />
  )
}
