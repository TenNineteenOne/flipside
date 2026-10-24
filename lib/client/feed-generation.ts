import { EXPLORE_REGEN_AT_KEY } from "@/lib/client/rail-session"

/**
 * The one client-side owner of POST /api/recommendations/generate: request,
 * response classification, toast copy, and the re-entry guard. Framework-free
 * (fetch / toast / storage / clock injected); `useFeedGeneration` is the thin
 * React adapter.
 *
 * Every caller reads the same `GenerateResult` and decides explicitly what
 * each `kind` means for it (e.g. splash treats a 429 as "a run is already
 * going, navigate"; the feed top-up is silent).
 */

export const GENERATE_URL = "/api/recommendations/generate"
export const EXPLORE_GENERATE_URL = "/api/explore/generate?force=true"

export type GenerateKind =
  /** 2xx with new recs written. */
  | "ready"
  /** 2xx, nothing written yet but background fill still running (count:0 + pending). */
  | "in-flight"
  /** 2xx, count:0, nothing pending — the genuine "no new artists" case. */
  | "empty"
  /** 429 cooldown ("please wait") — a generation is already running. */
  | "cooldown"
  /** 429 "discovery queue is full" — recs already exist. */
  | "queue-full"
  | "unauthorized"
  /** 503 — upstream music service unavailable. */
  | "unavailable"
  /** Any other status, or a network failure (status 0). */
  | "error"

export interface GenerateBody {
  count?: number
  error?: string
  /** True when background work (tier-2 / secondary pool) is still running via after(). */
  pending?: boolean
  softenedFilters?: { playThreshold?: boolean; coldStart?: boolean }
}

export interface GenerateResult {
  kind: GenerateKind
  /** HTTP status; 0 when the request itself failed. */
  status: number
  /** True for any 2xx (ready / in-flight / empty). */
  ok: boolean
  body: GenerateBody
  /** Server error text, or the network error's message when status is 0. */
  error?: string
}

/**
 * Classify a generate response. The 429 split is the only place the server's
 * message text is inspected (the route sends no machine-readable code).
 */
export function classifyGenerate(status: number, body: GenerateBody): GenerateKind {
  if (status === 401) return "unauthorized"
  if (status === 429) return (body.error ?? "").toLowerCase().includes("queue") ? "queue-full" : "cooldown"
  if (status === 503) return "unavailable"
  if (status >= 200 && status < 300) {
    if (body.count === 0) return body.pending ? "in-flight" : "empty"
    return "ready"
  }
  return "error"
}

/** Read + classify a generate Response. Never throws. */
export async function readGenerateResponse(res: Response): Promise<GenerateResult> {
  const body = (await res.json().catch(() => ({}))) as GenerateBody
  return { kind: classifyGenerate(res.status, body), status: res.status, ok: res.ok, body, error: body.error }
}

/** POST generate and classify. Never throws: a network failure is `{kind:"error", status:0}`. */
export async function postGenerate(fetchImpl: typeof fetch = fetch, url = GENERATE_URL): Promise<GenerateResult> {
  try {
    return await readGenerateResponse(await fetchImpl(url, { method: "POST" }))
  } catch (err) {
    return { kind: "error", status: 0, ok: false, body: {}, error: err instanceof Error ? err.message : undefined }
  }
}

/** Toast copy when the server widened its filters for this batch; null when it didn't. */
export function softenedFiltersMessage(body: GenerateBody): string | null {
  const s = body.softenedFilters
  if (!s) return null
  if (s.coldStart) return "Widened the search for this batch — falling back to starter picks."
  if (s.playThreshold) return "Widened the search for this batch — loosening the familiarity cap."
  return null
}

/** Feed-loader decision: refresh the page, poll for an in-flight run, or show an error. */
export function loaderAction(r: GenerateResult): { action: "refresh" } | { action: "poll" } | { action: "error"; message: string } {
  switch (r.kind) {
    case "ready":
    case "queue-full":
      return { action: "refresh" }
    case "in-flight":
    case "cooldown":
      return { action: "poll" }
    case "empty":
      return {
        action: "error",
        message: "No new artists found. Your listening history may be filtering everything out — try raising your play threshold in Settings.",
      }
    default:
      return {
        action: "error",
        message: r.status === 0 ? r.error ?? "Failed to load recommendations" : r.error ?? "Generation failed",
      }
  }
}

/** Settings-rebuild copy when the feed half failed. */
export function rebuildFailureMessage(r: GenerateResult): string {
  if (r.kind === "queue-full") return "Queue is full — review some artists first"
  if (r.kind === "cooldown") return "Cooling down — wait a few seconds and try again"
  if (r.kind === "unavailable") return "Music service temporarily unavailable — try again in a moment"
  return "Explore rebuilt, but feed failed"
}

export interface ToastLike {
  (message: string): void
  error: (message: string) => void
  success: (message: string) => void
}

export interface FeedGenerationDeps {
  fetchImpl?: typeof fetch
  toast: ToastLike
  /** Where the Explore-regen-in-flight flag is written (localStorage in the browser). */
  storage?: Pick<Storage, "setItem"> | null
  now?: () => number
  /** Called whenever `generating` flips. */
  onGeneratingChange?: (generating: boolean) => void
}

export interface FeedGeneration {
  readonly generating: boolean
  /**
   * POST generate under the re-entry guard. Resolves null when a run was
   * already in flight. Unless `silent`, toasts: the softened-filters note on
   * 2xx, the server's error text (or "Generation failed") on failure — except
   * 401, which the caller handles (redirect).
   */
  requestMore(opts?: { silent?: boolean }): Promise<GenerateResult | null>
  /** Settings "rebuild": replace the feed and force an Explore regen, with toasts. */
  rebuild(): Promise<void>
  /**
   * Drop the guard without waiting for the in-flight run (component unmount).
   * The abandoned run no longer flips `generating` when it settles.
   */
  release(): void
}

export function createFeedGeneration({
  fetchImpl = fetch,
  toast,
  storage = null,
  now = Date.now,
  onGeneratingChange,
}: FeedGenerationDeps): FeedGeneration {
  let generating = false
  let runId = 0

  // Synchronous guard: React state is batched, so a hair-trigger double-click
  // can slip past `disabled={generating}`; this blocks the second call instantly.
  function acquire(): number | null {
    if (generating) return null
    generating = true
    onGeneratingChange?.(true)
    return ++runId
  }
  function settle(id: number) {
    if (id !== runId) return
    generating = false
    onGeneratingChange?.(false)
  }

  return {
    get generating() {
      return generating
    },

    async requestMore({ silent = false } = {}) {
      const id = acquire()
      if (id === null) return null
      try {
        const r = await postGenerate(fetchImpl)
        if (!silent) {
          if (r.ok) {
            const soft = softenedFiltersMessage(r.body)
            if (soft) toast(soft)
          } else if (r.kind !== "unauthorized") {
            toast.error(r.error ?? "Generation failed")
          }
        }
        return r
      } finally {
        settle(id)
      }
    },

    async rebuild() {
      const id = acquire()
      if (id === null) return
      try {
        const [feedRes, exploreRes] = await Promise.all([
          fetchImpl(`${GENERATE_URL}?replace=true`, { method: "POST" }),
          fetchImpl(EXPLORE_GENERATE_URL, { method: "POST" }),
        ])

        // Signal to ExploreClient that a background regen is in flight so it
        // can start a poll-only when the user navigates to /explore before it
        // finishes. localStorage throws in private/incognito mode.
        try { storage?.setItem(EXPLORE_REGEN_AT_KEY, String(now())) } catch { /* private mode */ }

        const feed = await readGenerateResponse(feedRes)
        // Explore's 429 is its cooldown: a rebuild is already running, which
        // is what we asked for — treat it as success (owner decision #4).
        const exploreOk = exploreRes.ok || exploreRes.status === 429

        if (feed.ok) {
          const soft = softenedFiltersMessage(feed.body)
          if (soft) toast(soft)
        }

        if (!feed.ok && !exploreOk) {
          toast.error("Couldn't rebuild — try again")
        } else if (!feed.ok) {
          toast.error(rebuildFailureMessage(feed))
        } else if (!exploreOk) {
          toast.error("Feed rebuilt, but Explore failed")
        } else {
          // Both regen requests return as soon as the work is *scheduled* (feed
          // after its first batch, #144; Explore via after(), #145a), so word
          // it as in-progress rather than done.
          toast.success("Rebuilding feed & Explore — new picks are loading")
        }
      } catch {
        toast.error("Couldn't rebuild — try again")
      } finally {
        settle(id)
      }
    },

    release() {
      runId++
      generating = false
    },
  }
}
