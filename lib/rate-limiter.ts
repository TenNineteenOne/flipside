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
 * Check whether the given IP is rate-limited.
 * If not limited, increments the attempt counter in Supabase.
 */
export async function isRateLimited(ip: string): Promise<boolean> {
  const ipHash = hashIp(ip)
  const supabase = createServiceClient()
  const now = new Date()

  const { data: existing } = await supabase
    .from("login_attempts")
    .select("attempt_count, window_start")
    .eq("ip_hash", ipHash)
    .maybeSingle()

  const result = evaluateRateLimit(existing, now)

  if (result.limited) return true

  // Single upsert to minimize TOCTOU window
  await supabase
    .from("login_attempts")
    .upsert(
      {
        ip_hash: ipHash,
        attempt_count: result.newCount,
        window_start: result.resetWindow ? now.toISOString() : existing?.window_start ?? now.toISOString(),
      },
      { onConflict: "ip_hash" },
    )

  return false
}
