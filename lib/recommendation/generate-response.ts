export type GenerateOutcome = "ready" | "in-flight" | "error"

interface GenerateBody {
  count?: number
  error?: string
  /** True when background work (tier-2 / secondary pool) is still running via after(). */
  pending?: boolean
}

/**
 * Classify a POST /api/recommendations/generate response so the client can
 * decide whether to render the feed (`ready`), poll for an in-progress run
 * (`in-flight`), or show an error (`error`).
 *
 * The 30s cooldown returns 429 with a "please wait" message — that means a
 * generation is already running (likely a proactive pre-generation), so we
 * poll. A "queue full" 429 means recs already exist → ready. count:0 with
 * pending:true means tier-1 wrote nothing but background fill is still
 * running → poll (in-flight). count:0 without pending is the genuine "no
 * new artists" terminal case → error.
 */
export function classifyGenerateResponse(status: number, body: GenerateBody): GenerateOutcome {
  if (status === 429) {
    const msg = (body.error ?? "").toLowerCase()
    if (msg.includes("queue")) return "ready"
    return "in-flight"
  }
  if (status >= 200 && status < 300) {
    if (body.count === 0 && body.pending) return "in-flight"
    return body.count === 0 ? "error" : "ready"
  }
  return "error"
}
