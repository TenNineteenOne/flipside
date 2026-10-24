"use client"

import { useState } from "react"
import { toast } from "sonner"
import { createFeedGeneration, type FeedGeneration } from "@/lib/client/feed-generation"

/**
 * React adapter for `createFeedGeneration`: one controller per mount, with
 * `generating` mirrored into state for the UI (disabled buttons). The
 * controller's own flag is the synchronous re-entry guard.
 */
export function useFeedGeneration(): FeedGeneration & { generating: boolean } {
  const [generating, setGenerating] = useState(false)
  const [controller] = useState(() =>
    createFeedGeneration({
      toast,
      storage: typeof window === "undefined" ? null : safeLocalStorage(),
      onGeneratingChange: setGenerating,
    }),
  )
  return {
    generating,
    requestMore: controller.requestMore,
    rebuild: controller.rebuild,
    release: controller.release,
  }
}

function safeLocalStorage(): Storage | null {
  try {
    return window.localStorage
  } catch {
    return null
  }
}
