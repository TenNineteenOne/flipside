"use client"

import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react"
import { toast } from "sonner"
import { createRailSession, type RailSession, type RailSessionState } from "@/lib/client/rail-session"
import { useAdventurousMode } from "@/lib/hooks/use-adventurous-mode"
import type { RailPayload } from "@/lib/cards/explore-rail-payloads"

export interface UseRailSessionOpts {
  initialRails: RailPayload[]
  initialGeneratedAt: string | null
  initialAdventurous: boolean
  coldStart: boolean
  /** Latest-wins callbacks into the signal owner (read through a ref). */
  dropThumbsUp: (artistIds: string[]) => void
  clearSignals: () => void
}

/**
 * React adapter for `createRailSession`: one session per mount, state via
 * useSyncExternalStore, adventurous value owned by useAdventurousMode and
 * pushed into the session.
 */
export function useRailSession(opts: UseRailSessionOpts): RailSessionState & Omit<RailSession, "getState" | "subscribe" | "start" | "dispose"> {
  const { adventurous, setAdventurous } = useAdventurousMode(opts.initialAdventurous)

  const latest = useRef({ opts, setAdventurous })
  useEffect(() => {
    latest.current = { opts, setAdventurous }
  })

  const [session] = useState(() =>
    createRailSession({
      initialRails: opts.initialRails,
      initialGeneratedAt: opts.initialGeneratedAt,
      initialAdventurous: opts.initialAdventurous,
      storage: typeof window === "undefined" ? null : safeLocalStorage(),
      toast,
      persistAdventurous: (next) => latest.current.setAdventurous(next),
      dropThumbsUp: (ids) => latest.current.opts.dropThumbsUp(ids),
      clearSignals: () => latest.current.opts.clearSignals(),
    }),
  )

  const state = useSyncExternalStore(session.subscribe, session.getState, session.getState)

  // Layout effect so a flip reorders the rails before paint.
  useLayoutEffect(() => {
    session.setAdventurous(adventurous)
  }, [session, adventurous])

  useEffect(() => {
    session.start({ coldStart: opts.coldStart })
    return () => session.dispose()
    // Mount-only; start() is itself once-only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session])

  return {
    ...state,
    select: session.select,
    setAdventurous: session.setAdventurous,
    toggleAdventurous: session.toggleAdventurous,
    shuffle: session.shuffle,
    applyAdventurous: session.applyAdventurous,
  }
}

function safeLocalStorage(): Storage | null {
  try {
    return window.localStorage
  } catch {
    return null
  }
}
