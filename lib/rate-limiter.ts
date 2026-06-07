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
