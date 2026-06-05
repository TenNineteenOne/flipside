export type GenerateOutcome = "ready" | "in-flight" | "error"

interface GenerateBody {
  count?: number
  error?: string
}

/**
 * Classify a POST /api/recommendations/generate response so the client can
 * decide whether to render the feed (`ready`), poll for an in-progress run
 * (`in-flight`), or show an error (`error`).
 *
 * The 30s cooldown returns 429 with a "please wait" message — that means a
 * generation is already running (likely a proactive pre-generation), so we
 * poll. A "queue full" 429 means recs already exist → ready. count:0 means a
 * successful run found nothing → error (actionable message upstream).
 */
export function classifyGenerateResponse(status: number, body: GenerateBody): GenerateOutcome {
  if (status === 429) {
    const msg = (body.error ?? "").toLowerCase()
    if (msg.includes("queue")) return "ready"
    return "in-flight"
  }
  if (status >= 200 && status < 300) {
    return body.count === 0 ? "error" : "ready"
  }
  return "error"
}
