import { createHash } from "crypto"
import { createServiceClient } from "@/lib/supabase/server"

const MAX_ATTEMPTS = 10
const WINDOW_MS = 60_000 // 1 minute

/** Hash an IP address with SHA-256 so raw IPs are never stored. */
export function hashIp(ip: string): string {
  return createHash("sha256").update(ip).digest("hex")
}

/**
 * Pure decision logic: given the current attempt state and the current time,
 * decide whether the request is rate-limited and what the new state should be.
 */
export function evaluateRateLimit(
  existing: { attempt_count: number; window_start: string } | null,
  now: Date,
): { limited: boolean; newCount: number; resetWindow: boolean } {
  if (!existing) {
    return { limited: false, newCount: 1, resetWindow: true }
  }

  const windowStart = new Date(existing.window_start).getTime()
  const elapsed = now.getTime() - windowStart

  if (elapsed > WINDOW_MS) {
    return { limited: false, newCount: 1, resetWindow: true }
  }

  const nextCount = existing.attempt_count + 1
  if (nextCount > MAX_ATTEMPTS) {
    return { limited: true, newCount: existing.attempt_count, resetWindow: false }
  }

  return { limited: false, newCount: nextCount, resetWindow: false }
}

/**
 * Check whether the given IP is rate-limited, atomically recording the attempt.
 *
 * Delegates the read-modify-write to the `rpc_register_login_attempt` Postgres
 * function (migration 0035) so concurrent requests from one IP can't race past
 * the cap — the DB row lock serializes them. `evaluateRateLimit` above remains
 * the canonical decision logic the SQL mirrors (and what the unit tests cover).
 *
 * Fails open on infra error: a DB hiccup must not lock everyone out of a
 * username-only login (no password to brute-force, so the abuse value is low).
 */
export async function isRateLimited(ip: string): Promise<boolean> {
  const ipHash = hashIp(ip)
  const supabase = createServiceClient()

  const { data, error } = await supabase.rpc("rpc_register_login_attempt", {
    p_ip_hash: ipHash,
    p_window_ms: WINDOW_MS,
    p_max_attempts: MAX_ATTEMPTS,
  })

  if (error) {
    console.error("[rate-limiter] rpc_register_login_attempt failed:", error.message)
    return false
  }

  return data === true
}

/**
 * Fixed-window per-key limiter backed by an in-memory Map.
 *
 * ⚠️ Deliberately per-serverless-instance, NOT global — unlike `isRateLimited`
 * above (DB-backed via `rpc_register_login_attempt`, consistent across every
 * instance), this counter lives in one Lambda/Edge instance's memory and
 * resets on cold start. Multiple concurrent instances each get their own
 * budget, so the *effective* ceiling under scale-out is `max * instanceCount`,
 * not `max`. Fine for a speed-bump against casual abuse; not a real cap.
 * Upgrade path: move to the DB-backed pattern above (or Redis) if this ever
 * needs to be a hard limit.
 *
 * Semantics (fixed window, not sliding): the first call for a key opens a
 * window and is always allowed. Each subsequent call within `windowMs` of the
 * window's start is allowed and increments the count *unless* the count has
 * already reached `max`, in which case it's rejected and the count does not
 * increment further. So exactly `max` calls are allowed per window, and the
 * window resets on the first call after it expires.
 */
export function createWindowLimiter(opts: { max: number; windowMs: number }) {
  const buckets = new Map<string, { count: number; windowStart: number }>()
  return function checkAndConsume(key: string): boolean {
    const now = Date.now()
    const bucket = buckets.get(key)
    if (!bucket || now - bucket.windowStart > opts.windowMs) {
      buckets.set(key, { count: 1, windowStart: now })
      return false
    }
    if (bucket.count >= opts.max) return true
    bucket.count += 1
    return false
  }
}
