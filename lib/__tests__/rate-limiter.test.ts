import { describe, it, expect, vi, afterEach } from "vitest"

const rpc = vi.hoisted(() => vi.fn())
vi.mock("@/lib/supabase/server", () => ({ createServiceClient: () => ({ rpc }) }))

import {
  hashIp,
  evaluateRateLimit,
  createWindowLimiter,
  networkOf,
  loginLimitBuckets,
  isRateLimited,
} from "../rate-limiter"

describe("networkOf", () => {
  it("keys IPv6 by its /64, normalising zero-compression and leading zeros", () => {
    expect(networkOf("2001:db8:0:1::abcd")).toBe("2001:db8:0:1::/64")
    expect(networkOf("2001:0DB8:0000:0001:ffff:1:2:3")).toBe("2001:db8:0:1::/64")
    expect(networkOf("2001:db8::1")).toBe("2001:db8:0:0::/64")
    expect(networkOf("fe80::1%eth0")).toBe("fe80:0:0:0::/64")
  })

  it("puts every address inside one /64 in the same network", () => {
    expect(networkOf("2001:db8:aa:bb:1::1")).toBe(networkOf("2001:db8:aa:bb:ffff:ffff:ffff:ffff"))
    expect(networkOf("2001:db8:aa:bb::1")).not.toBe(networkOf("2001:db8:aa:bc::1"))
  })

  it("keys IPv4 (and IPv4-mapped IPv6) by the full address", () => {
    expect(networkOf("203.0.113.7")).toBe("203.0.113.7")
    expect(networkOf("::ffff:203.0.113.7")).toBe("203.0.113.7")
    expect(networkOf("203.0.113.8")).not.toBe(networkOf("203.0.113.7"))
  })

  it("passes unparseable values through", () => {
    expect(networkOf("unknown")).toBe("unknown")
  })
})

describe("loginLimitBuckets", () => {
  it("IPv4: per-IP (unchanged key) then global, no separate network bucket", () => {
    expect(loginLimitBuckets("203.0.113.7")).toEqual([
      { key: hashIp("203.0.113.7"), max: 10 },
      { key: "global", max: 300 },
    ])
  })

  it("IPv6: per-IP, then hashed /64 network, then global", () => {
    expect(loginLimitBuckets("2001:db8:0:1::abcd")).toEqual([
      { key: hashIp("2001:db8:0:1::abcd"), max: 10 },
      { key: hashIp("net:2001:db8:0:1::/64"), max: 20 },
      { key: "global", max: 300 },
    ])
  })
})

describe("isRateLimited", () => {
  afterEach(() => {
    rpc.mockReset()
  })

  it("stops at the first full bucket, so a blocked IP isn't charged globally", async () => {
    rpc.mockResolvedValueOnce({ data: true, error: null })
    expect(await isRateLimited("2001:db8::1")).toBe(true)
    expect(rpc).toHaveBeenCalledTimes(1)
  })

  it("is limited when a later bucket (global) is full", async () => {
    rpc
      .mockResolvedValueOnce({ data: false, error: null })
      .mockResolvedValueOnce({ data: false, error: null })
      .mockResolvedValueOnce({ data: true, error: null })
    expect(await isRateLimited("2001:db8::1")).toBe(true)
    expect(rpc.mock.calls[2][1].p_ip_hash).toBe("global")
  })

  it("allows when every bucket has room", async () => {
    rpc.mockResolvedValue({ data: false, error: null })
    expect(await isRateLimited("203.0.113.7")).toBe(false)
    expect(rpc).toHaveBeenCalledTimes(2)
  })

  it("fails open on DB error", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {})
    rpc.mockResolvedValue({ data: null, error: { message: "down" } })
    expect(await isRateLimited("203.0.113.7")).toBe(false)
  })
})

describe("hashIp", () => {
  it("returns a 64-char hex string (SHA-256)", () => {
    const result = hashIp("192.168.1.1")
    expect(result).toMatch(/^[a-f0-9]{64}$/)
  })

  it("returns the same hash for the same IP", () => {
    expect(hashIp("10.0.0.1")).toBe(hashIp("10.0.0.1"))
  })

  it("returns different hashes for different IPs", () => {
    expect(hashIp("10.0.0.1")).not.toBe(hashIp("10.0.0.2"))
  })
})

describe("evaluateRateLimit", () => {
  const now = new Date("2026-04-18T12:00:00Z")

  it("allows the first attempt when no existing record", () => {
    const result = evaluateRateLimit(null, now)
    expect(result).toEqual({ limited: false, newCount: 1, resetWindow: true })
  })

  it("allows attempts within the window when under the limit", () => {
    const existing = {
      attempt_count: 5,
      window_start: new Date("2026-04-18T11:59:30Z").toISOString(), // 30s ago
    }
    const result = evaluateRateLimit(existing, now)
    expect(result.limited).toBe(false)
    expect(result.newCount).toBe(6)
    expect(result.resetWindow).toBe(false)
  })

  it("blocks when attempt count reaches the limit", () => {
    const existing = {
      attempt_count: 10,
      window_start: new Date("2026-04-18T11:59:30Z").toISOString(), // 30s ago
    }
    const result = evaluateRateLimit(existing, now)
    expect(result.limited).toBe(true)
  })

  it("resets the window when it has expired", () => {
    const existing = {
      attempt_count: 10,
      window_start: new Date("2026-04-18T11:58:00Z").toISOString(), // 2 minutes ago
    }
    const result = evaluateRateLimit(existing, now)
    expect(result).toEqual({ limited: false, newCount: 1, resetWindow: true })
  })

  it("blocks at exactly 11 attempts (> 10)", () => {
    const existing = {
      attempt_count: 10,
      window_start: new Date("2026-04-18T11:59:50Z").toISOString(), // 10s ago
    }
    const result = evaluateRateLimit(existing, now)
    expect(result.limited).toBe(true)
  })

  it("allows the 10th attempt (count goes from 9 to 10)", () => {
    const existing = {
      attempt_count: 9,
      window_start: new Date("2026-04-18T11:59:50Z").toISOString(),
    }
    const result = evaluateRateLimit(existing, now)
    expect(result.limited).toBe(false)
    expect(result.newCount).toBe(10)
  })
})

describe("createWindowLimiter", () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it("allows exactly `max` calls per key within the window, then blocks", () => {
    const check = createWindowLimiter({ max: 3, windowMs: 60_000 })
    expect(check("u1")).toBe(false) // 1st
    expect(check("u1")).toBe(false) // 2nd
    expect(check("u1")).toBe(false) // 3rd
    expect(check("u1")).toBe(true) // 4th — blocked
    expect(check("u1")).toBe(true) // stays blocked, doesn't overflow count
  })

  it("tracks separate buckets per key", () => {
    const check = createWindowLimiter({ max: 1, windowMs: 60_000 })
    expect(check("a")).toBe(false)
    expect(check("b")).toBe(false)
    expect(check("a")).toBe(true)
  })

  it("resets the window after windowMs elapses", () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-04-18T12:00:00Z"))
    const check = createWindowLimiter({ max: 1, windowMs: 60_000 })
    expect(check("u1")).toBe(false)
    expect(check("u1")).toBe(true)
    vi.setSystemTime(new Date("2026-04-18T12:01:01Z")) // 61s later
    expect(check("u1")).toBe(false)
  })
})
