import { createKeyedSerializer } from "@/lib/keyed-serializer"

/**
 * Framework-free artist-signal controllers (feedback thumbs/skip, saves) under
 * `useArtistFeedback` / `useArtistSaves`. Both share one optimistic keyed
 * store:
 *
 *  - Optimistic: a tap updates the visible state immediately — even while an
 *    earlier request for the same artist is still in flight — and is
 *    classified against what the user saw when they tapped.
 *  - Serialized: network calls for one artist run strictly in tap order.
 *  - Rollback: the store tracks each artist's last *confirmed* value. When a
 *    call fails and no later call for that artist is still queued, the visible
 *    value falls back to the confirmed one. While later calls are queued the
 *    visible value is left alone — it already shows the user's latest intent,
 *    and the last call to settle decides.
 */

// ─── Generic optimistic keyed store ──────────────────────────────────────────

export interface OptimisticStore<V> {
  get(key: string): V | undefined
  snapshot(): ReadonlyMap<string, V>
  subscribe(listener: () => void): () => void
  /** Show `target` now; run `send` in per-key order; resolve to its success. */
  optimistic(key: string, target: V | undefined, send: () => Promise<void>): Promise<boolean>
  /** Run `send` in per-key order; only on success show + confirm `target`. */
  confirmedOp(key: string, target: V | undefined, send: () => Promise<void>): Promise<boolean>
  /** Bulk local replacement (visible and confirmed) — no network. */
  replace(updater: (prev: ReadonlyMap<string, V>) => ReadonlyMap<string, V>): void
}

export function createOptimisticStore<V>(initial: Iterable<[string, V]> = []): OptimisticStore<V> {
  let visible: ReadonlyMap<string, V> = new Map(initial)
  let confirmed: ReadonlyMap<string, V> = visible
  const pending = new Map<string, number>()
  const queue = createKeyedSerializer()
  const listeners = new Set<() => void>()

  function withKey(m: ReadonlyMap<string, V>, key: string, v: V | undefined): ReadonlyMap<string, V> {
    if (m.get(key) === v && (v !== undefined || !m.has(key))) return m
    const n = new Map(m)
    if (v === undefined) n.delete(key)
    else n.set(key, v)
    return n
  }
  function show(key: string, v: V | undefined) {
    const next = withKey(visible, key, v)
    if (next === visible) return
    visible = next
    for (const l of listeners) l()
  }

  return {
    get: (key) => visible.get(key),
    snapshot: () => visible,
    subscribe(listener) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },

    optimistic(key, target, send) {
      show(key, target)
      pending.set(key, (pending.get(key) ?? 0) + 1)
      return queue(key, async () => {
        let ok = true
        try {
          await send()
          confirmed = withKey(confirmed, key, target)
        } catch {
          ok = false
        }
        const left = (pending.get(key) ?? 1) - 1
        if (left === 0) pending.delete(key)
        else pending.set(key, left)
        if (!ok && left === 0) show(key, confirmed.get(key))
        return ok
      })
    },

    confirmedOp(key, target, send) {
      return queue(key, async () => {
        try {
          await send()
        } catch {
          return false
        }
        confirmed = withKey(confirmed, key, target)
        show(key, target)
        return true
      })
    },

    replace(updater) {
      const next = updater(visible)
      confirmed = updater(confirmed)
      if (next === visible) return
      visible = next
      for (const l of listeners) l()
    },
  }
}

export interface ToastErrorLike {
  error: (message: string) => void
}

// ─── Feedback ────────────────────────────────────────────────────────────────

export const DEFAULT_FEEDBACK_MESSAGES = {
  undoFailed: "Couldn't undo — try again",
  saveFailed: "Couldn't save feedback — try again",
} as const

/** Build the DELETE URL for an undo operation. */
export function buildFeedbackDeleteUrl(artistId: string): string {
  return `/api/feedback/${encodeURIComponent(artistId)}`
}

/**
 * Build the POST body for a feedback signal. railKey is omitted when
 * undefined so JSON.stringify never sends `"railKey": null`.
 */
export function buildFeedbackPostBody(
  artistId: string,
  signal: string,
  railKey: string | undefined,
): Record<string, string> {
  const body: Record<string, string> = { artistId, signal }
  if (railKey !== undefined) body.railKey = railKey
  return body
}

/**
 * "local"  — local-only, no network call (signal is in localOnlySignals)
 * "delete" — undo (thumbs_up toggled off)
 * "post"   — normal signal (thumbs_up first time, thumbs_down, etc.)
 */
export function classifyFeedbackOp(
  signal: string,
  currentSignal: string | undefined,
  localOnlySignals: readonly string[] = [],
): "local" | "delete" | "post" {
  if (localOnlySignals.includes(signal)) return "local"
  if (signal === "thumbs_up" && currentSignal === "thumbs_up") return "delete"
  return "post"
}

export interface ArtistFeedbackDeps {
  fetchImpl?: typeof fetch
  toast: ToastErrorLike
  /** Initial rail (see setRailKey). */
  railKey?: string
  /** Signals applied locally only (Explore: ["skip"]). */
  localOnlySignals?: readonly string[]
  messages?: { undoFailed?: string; saveFailed?: string }
}

export interface ArtistFeedback {
  store: OptimisticStore<string>
  /**
   * Set a signal (optimistic, serialized per artist). thumbs_up on an already
   * thumbs_up artist → DELETE /api/feedback/{id} (undo; seen_at stays set, so
   * session-only); local-only signals skip the network; else POST. Resolves to
   * success; failures toast.
   */
  setSignal(artistId: string, signal: string): Promise<boolean>
  /**
   * Unconditionally DELETE the artist's feedback. Not optimistic: the signal
   * clears only once the server confirms (History keeps the row until then).
   */
  removeSignal(artistId: string): Promise<boolean>
  /**
   * DELETE /api/dismiss/{id} — clears skip_at + seen_at for a dismissed
   * artist (no feedback row exists). Not optimistic. Failures toast undoFailed.
   */
  dismiss(artistId: string): Promise<boolean>
  /**
   * Rail the user is on. Read when a POST is dispatched (not when tapped), so
   * a rail switch while an earlier call is in flight sends the current rail.
   */
  setRailKey(railKey: string | undefined): void
}

export function createArtistFeedback({
  fetchImpl = fetch,
  toast,
  railKey,
  localOnlySignals = [],
  messages,
}: ArtistFeedbackDeps): ArtistFeedback {
  const store = createOptimisticStore<string>()
  const undoFailed = messages?.undoFailed ?? DEFAULT_FEEDBACK_MESSAGES.undoFailed
  const saveFailed = messages?.saveFailed ?? DEFAULT_FEEDBACK_MESSAGES.saveFailed

  async function del(url: string) {
    const res = await fetchImpl(url, { method: "DELETE" })
    if (!res.ok && res.status !== 204) throw new Error("Server error")
  }

  return {
    store,

    async setSignal(artistId, signal) {
      const op = classifyFeedbackOp(signal, store.get(artistId), localOnlySignals)
      if (op === "local") return store.optimistic(artistId, signal, async () => {})
      if (op === "delete") {
        const ok = await store.optimistic(artistId, undefined, () => del(buildFeedbackDeleteUrl(artistId)))
        if (!ok) toast.error(undoFailed)
        return ok
      }
      const ok = await store.optimistic(artistId, signal, async () => {
        const res = await fetchImpl("/api/feedback", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(buildFeedbackPostBody(artistId, signal, railKey)),
        })
        if (!res.ok) throw new Error("Server error")
      })
      if (!ok) toast.error(saveFailed)
      return ok
    },

    async removeSignal(artistId) {
      const ok = await store.confirmedOp(artistId, undefined, () => del(buildFeedbackDeleteUrl(artistId)))
      if (!ok) toast.error(undoFailed)
      return ok
    },

    async dismiss(artistId) {
      const ok = await store.confirmedOp(artistId, undefined, async () => {
        const res = await fetchImpl(`/api/dismiss/${artistId}`, { method: "DELETE" })
        if (!res.ok) throw new Error("Server error")
      })
      if (!ok) toast.error(undoFailed)
      return ok
    },

    setRailKey(next) {
      railKey = next
    },
  }
}

// ─── Saves ───────────────────────────────────────────────────────────────────

export const DEFAULT_SAVES_MESSAGES = {
  saveFailed: "Couldn't save — try again",
  unsaveFailed: "Couldn't unsave — try again",
} as const

/** Fetch options for a save (POST) or unsave (DELETE) of /api/saves. */
export function buildSaveFetchInit(artistId: string, willUnsave: boolean): RequestInit {
  return {
    method: willUnsave ? "DELETE" : "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ artistId }),
  }
}

export interface ArtistSavesDeps {
  fetchImpl?: typeof fetch
  toast: ToastErrorLike
  initialSavedIds?: Iterable<string>
  messages?: { saveFailed?: string; unsaveFailed?: string }
}

export interface ArtistSaves {
  store: OptimisticStore<true>
  /** Optimistically flip saved state, then POST/DELETE /api/saves (serialized per artist). */
  toggleSave(artistId: string): Promise<boolean>
}

export function createArtistSaves({ fetchImpl = fetch, toast, initialSavedIds = [], messages }: ArtistSavesDeps): ArtistSaves {
  const store = createOptimisticStore<true>(Array.from(initialSavedIds, (id) => [id, true] as [string, true]))
  const saveFailed = messages?.saveFailed ?? DEFAULT_SAVES_MESSAGES.saveFailed
  const unsaveFailed = messages?.unsaveFailed ?? DEFAULT_SAVES_MESSAGES.unsaveFailed

  return {
    store,
    async toggleSave(artistId) {
      const willUnsave = store.get(artistId) === true
      const ok = await store.optimistic(artistId, willUnsave ? undefined : true, async () => {
        const res = await fetchImpl("/api/saves", buildSaveFetchInit(artistId, willUnsave))
        if (!res.ok) throw new Error("Server error")
      })
      if (!ok) toast.error(willUnsave ? unsaveFailed : saveFailed)
      return ok
    },
  }
}
