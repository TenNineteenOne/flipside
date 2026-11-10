import { createHash } from "crypto"
import { isIPv4, isIPv6 } from "net"
import { createServiceClient } from "@/lib/supabase/server"

const MAX_ATTEMPTS = 10 // per IP address
// Per IPv6 /64 (one subscriber/household on residential v6). Above the per-IP
// cap so several devices behind one /64 still fit; stops one /64 rotating
// through its 2^64 addresses for fresh per-IP buckets.
const MAX_NETWORK_ATTEMPTS = 20
// All sign-in attempts from every source. A friend group never comes close
// (300 sign-ins in one minute); a distributed guesser hits it. Trade-off: an
// attacker with enough addresses can exhaust it and block everyone until the
// fixed 1-minute window rolls over after the flood stops.
const MAX_GLOBAL_ATTEMPTS = 300
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
 * The network an address belongs to, for the per-network bucket.
 * - IPv6 → its /64 prefix, normalised (`2001:db8:0:1::/64`). A /64 is what one
 *   subscriber gets, so rotating addresses inside it no longer buys new buckets.
 * - IPv4 (and IPv4-mapped IPv6) → the full address. IPv4 addresses are scarce,
 *   so the address already is the unit an attacker pays for; a /24 would mostly
 *   add false positives across shared NAT / campus / corporate ranges.
 * - Anything unparseable (e.g. "unknown") → returned as-is.
 */
export function networkOf(ip: string): string {
  const addr = ip.split("%")[0].toLowerCase() // drop any zone id
  if (isIPv4(addr) || !isIPv6(addr)) return addr
  const mapped = addr.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)
  if (mapped) return mapped[1]
  const [head, tail] = addr.split("::")
  const h = head ? head.split(":") : []
  const t = tail ? tail.split(":") : []
  const groups = tail === undefined
    ? h
    : [...h, ...Array<string>(Math.max(0, 8 - h.length - t.length)).fill("0"), ...t]
  return groups.slice(0, 4).map((g) => parseInt(g, 16).toString(16)).join(":") + "::/64"
}

/**
 * The buckets one sign-in attempt is charged to, checked in this order.
 * All keys share the `login_attempts.ip_hash` column, so raw addresses are
 * hashed. The per-IP key is unchanged from before, so existing rows carry over.
 * IPv4 gets no separate network bucket: its network is the address itself.
 */
export function loginLimitBuckets(ip: string): { key: string; max: number }[] {
  const buckets = [{ key: hashIp(ip), max: MAX_ATTEMPTS }]
  const network = networkOf(ip)
  if (network !== ip) buckets.push({ key: hashIp(`net:${network}`), max: MAX_NETWORK_ATTEMPTS })
  buckets.push({ key: "global", max: MAX_GLOBAL_ATTEMPTS })
  return buckets
}

/**
 * Check whether a sign-in attempt from `ip` is rate-limited, atomically
 * recording it against the per-IP, per-network (IPv6 /64) and global buckets.
 *
 * Each bucket goes through the `rpc_register_login_attempt` Postgres function
 * (migration 0035) so concurrent requests can't race past a cap — the DB row
 * lock serializes them. `evaluateRateLimit` above remains the canonical
 * decision logic the SQL mirrors (and what the unit tests cover).
 *
 * Buckets are checked in order and stop at the first full one, so an attempt
 * already rejected per-IP is never charged to the global bucket: a single
 * address hammering the form can't fill the global cap by itself.
 *
 * Fails open on infra error, per bucket: a DB hiccup must not lock everyone
 * out of a username-only login. In practice a DB outage fails the sign-in
 * anyway, since `authorize` reads the `users` table right after this.
 */
export async function isRateLimited(ip: string): Promise<boolean> {
  const supabase = createServiceClient()

  for (const { key, max } of loginLimitBuckets(ip)) {
    const { data, error } = await supabase.rpc("rpc_register_login_attempt", {
      p_ip_hash: key,
      p_window_ms: WINDOW_MS,
      p_max_attempts: max,
    })

    if (error) {
      console.error("[rate-limiter] rpc_register_login_attempt failed:", error.message)
      continue
    }
    if (data === true) return true
  }

  return false
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
