import { describe, it, expect } from "vitest"
import { hashIp, evaluateRateLimit } from "../rate-limiter"

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
