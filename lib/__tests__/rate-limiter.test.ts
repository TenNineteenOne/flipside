import { describe, it, expect, vi, afterEach } from "vitest"

const rpc = vi.hoisted(() => vi.fn())
vi.mock("@/lib/supabase/server", () => ({ createServiceClient: () => ({ rpc }) }))

import {
  hashIp,
  createWindowLimiter,
  networkOf,
  loginLimitBuckets,
  isRateLimited,
  isNewAccountLimited,
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

describe("isNewAccountLimited (#218)", () => {
  afterEach(() => {
    rpc.mockReset()
  })

  it("charges one 24h bucket of 5 keyed on the network, separate from the sign-in buckets", async () => {
    rpc.mockResolvedValue({ data: false, error: null })
    expect(await isNewAccountLimited("203.0.113.7")).toBe(false)
    expect(rpc).toHaveBeenCalledExactlyOnceWith("rpc_register_login_attempt", {
      p_ip_hash: hashIp("new:203.0.113.7"),
      p_window_ms: 86_400_000,
      p_max_attempts: 5,
    })
    expect(loginLimitBuckets("203.0.113.7").map((b) => b.key)).not.toContain(hashIp("new:203.0.113.7"))
  })

  it("shares the bucket across one IPv6 /64", async () => {
    rpc.mockResolvedValue({ data: false, error: null })
    await isNewAccountLimited("2001:db8:0:1::a")
    await isNewAccountLimited("2001:db8:0:1::b")
    expect(rpc.mock.calls[0][1].p_ip_hash).toBe(hashIp("new:2001:db8:0:1::/64"))
    expect(rpc.mock.calls[1][1].p_ip_hash).toBe(rpc.mock.calls[0][1].p_ip_hash)
  })

  it("is limited when the database says the bucket is over", async () => {
    rpc.mockResolvedValue({ data: true, error: null })
    expect(await isNewAccountLimited("203.0.113.7")).toBe(true)
  })

  it("fails open on a DB error", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {})
    rpc.mockResolvedValue({ data: null, error: { message: "down" } })
    expect(await isNewAccountLimited("203.0.113.7")).toBe(false)
  })

  it.each(["unknown", "127.0.0.1", "::1", "::ffff:127.0.0.1"])("does not cap %s (local dev)", async (ip) => {
    expect(await isNewAccountLimited(ip)).toBe(false)
    expect(rpc).not.toHaveBeenCalled()
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
