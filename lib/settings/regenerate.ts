import { toast } from "sonner"

/**
 * Translate a failed feed regenerate response into an actionable toast.
 * Explore has no cooldown, so when the combined regenerate lands during the
 * feed's 30s cooldown the user used to see a vague "Explore rebuilt, but feed
 * failed" — now they see the actual reason.
 */
async function describeFeedFailure(res: Response): Promise<string> {
  const data = (await res.json().catch(() => ({}))) as { error?: string }
  const msg = (data.error ?? "").toLowerCase()
  if (res.status === 429) {
    if (msg.includes("discovery queue") || msg.includes("queue")) {
      return "Queue is full — review some artists first"
    }
    return "Cooling down — wait a few seconds and try again"
  }
  if (res.status === 503) {
    return "Music service temporarily unavailable — try again in a moment"
  }
  return "Explore rebuilt, but feed failed"
}

export interface RegenerateOpts {
  /**
   * Synchronous re-entry guard. Mutating a ref happens immediately, unlike
   * React state — so two rapid-fire calls (e.g. user toggling two settings
   * in quick succession, each firing onRegenerate after its PATCH lands)
   * can't both pass the guard before the first call commits. Matches the
   * `isGeneratingRef` pattern in feed-client.tsx's handleGenerateMore.
   */
  isGeneratingRef: { current: boolean }
  /** React state setter, used purely to feed the UI (disabled buttons, etc). */
  setGenerating: (b: boolean) => void
}

/**
 * Fire both /api/recommendations/generate and /api/explore/generate in
 * parallel and surface appropriate toasts. Guards against concurrent calls
 * via a synchronous ref so that two rapid-fire calls cannot both fire
 * before React commits the first `setGenerating(true)`.
 */
export async function regenerateFeedAndExplore(opts: RegenerateOpts): Promise<void> {
  if (opts.isGeneratingRef.current) return
  opts.isGeneratingRef.current = true
  opts.setGenerating(true)
  try {
    const [feedRes, exploreRes] = await Promise.all([
      fetch("/api/recommendations/generate?replace=true", { method: "POST" }),
      fetch("/api/explore/generate?force=true", { method: "POST" }),
    ])

    // Signal to ExploreClient that a background regen is in flight so it can
    // start a poll-only when the user navigates to /explore before it finishes.
    // Wrap in try/catch — localStorage throws in private/incognito mode.
    try { localStorage.setItem("explore-regen-at", String(Date.now())) } catch { /* private mode */ }

    if (feedRes.ok) {
      const data = (await feedRes.json().catch(() => ({}))) as {
        softenedFilters?: { playThreshold?: boolean; coldStart?: boolean }
      }
      if (data.softenedFilters) {
        const s = data.softenedFilters
        const bits: string[] = []
        if (s.coldStart) bits.push("falling back to starter picks")
        else if (s.playThreshold) bits.push("loosening the familiarity cap")
        if (bits.length > 0) {
          toast(`Widened the search for this batch — ${bits.join(" and ")}.`)
        }
      }
    }

    if (!feedRes.ok && !exploreRes.ok) {
      toast.error("Couldn't rebuild — try again")
    } else if (!feedRes.ok) {
      toast.error(await describeFeedFailure(feedRes))
    } else if (!exploreRes.ok) {
      toast.error("Feed rebuilt, but Explore failed")
    } else {
      // Both regen requests now return as soon as the work is *scheduled*: the
      // feed responds after its first batch is written and keeps filling in the
      // background (#144), and Explore regenerates in an after() task (#145a).
      // So this fires in a few seconds, not after the full 54-74s rebuild —
      // word it as in-progress rather than done.
      toast.success("Rebuilding feed & Explore — new picks are loading")
    }
  } catch {
    toast.error("Couldn't rebuild — try again")
  } finally {
    opts.isGeneratingRef.current = false
    opts.setGenerating(false)
  }
}
