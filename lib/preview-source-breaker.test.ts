import { describe, it, expect } from "vitest"
import { PreviewSourceBreaker } from "./preview-source-breaker"

/**
 * State-machine tests for the circuit breaker used to protect iTunes and
 * Spotify from credential-level rate-limit blocks during preview lookups.
 *
 * All tests use an injectable clock so no real timers are needed.
 */

describe("PreviewSourceBreaker", () => {
  it("starts closed and allows requests", () => {
    const t = 0
    const b = new PreviewSourceBreaker({ failureThreshold: 3, cooldownMs: 60_000, now: () => t })
    expect(b.state()).toBe("closed")
    expect(b.canRequest()).toBe(true)
  })

  it("trips open after exactly failureThreshold consecutive failures", () => {
    const t = 0
    const b = new PreviewSourceBreaker({ failureThreshold: 3, cooldownMs: 60_000, now: () => t })
    b.recordFailure()
    expect(b.state()).toBe("closed")
    b.recordFailure()
    expect(b.state()).toBe("closed")
    b.recordFailure() // third — threshold reached
    expect(b.state()).toBe("open")
    expect(b.canRequest()).toBe(false)
  })

  it("canRequest returns false during the cooldown window", () => {
    let t = 0
    const b = new PreviewSourceBreaker({ failureThreshold: 2, cooldownMs: 60_000, now: () => t })
    b.recordFailure()
    b.recordFailure()
    expect(b.state()).toBe("open")

    // mid-cooldown
    t = 30_000
    expect(b.canRequest()).toBe(false)
    expect(b.state()).toBe("open")

    // just before expiry
    t = 59_999
    expect(b.canRequest()).toBe(false)
  })

  it("transitions to half-open after cooldown elapses", () => {
    let t = 0
    const b = new PreviewSourceBreaker({ failureThreshold: 2, cooldownMs: 60_000, now: () => t })
    b.recordFailure()
    b.recordFailure()
    expect(b.state()).toBe("open")

    // advance past cooldown
    t = 60_000
    expect(b.canRequest()).toBe(true)
    expect(b.state()).toBe("half-open")
  })

  it("closes on success from half-open and resets failure count", () => {
    let t = 0
    const b = new PreviewSourceBreaker({ failureThreshold: 2, cooldownMs: 60_000, now: () => t })
    b.recordFailure()
    b.recordFailure()

    t = 60_000
    expect(b.state()).toBe("half-open")
    b.recordSuccess()
    expect(b.state()).toBe("closed")
    expect(b.canRequest()).toBe(true)

    // failure count was reset — need to fail twice again to re-open
    b.recordFailure()
    expect(b.state()).toBe("closed")
    b.recordFailure()
    expect(b.state()).toBe("open")
  })

  it("re-opens on failure during half-open and starts a new cooldown", () => {
    let t = 0
    const b = new PreviewSourceBreaker({ failureThreshold: 2, cooldownMs: 60_000, now: () => t })
    b.recordFailure()
    b.recordFailure()

    t = 60_000 // half-open
    expect(b.state()).toBe("half-open")
    b.recordFailure()
    expect(b.state()).toBe("open")

    // new cooldown starts from t=60_000
    t = 90_000
    expect(b.canRequest()).toBe(false)
    t = 120_000
    expect(b.canRequest()).toBe(true)
    expect(b.state()).toBe("half-open")
  })

  it("a success before the threshold resets the consecutive-failure counter", () => {
    const t = 0
    const b = new PreviewSourceBreaker({ failureThreshold: 3, cooldownMs: 60_000, now: () => t })
    b.recordFailure()
    b.recordFailure()
    // still closed
    expect(b.state()).toBe("closed")
    b.recordSuccess()
    // counter resets — need 3 more to trip
    b.recordFailure()
    b.recordFailure()
    expect(b.state()).toBe("closed")
    b.recordFailure()
    expect(b.state()).toBe("open")
  })

  it("openUntil blocks until the given timestamp", () => {
    let t = 0
    const b = new PreviewSourceBreaker({ failureThreshold: 5, cooldownMs: 60_000, now: () => t })
    expect(b.state()).toBe("closed")

    b.openUntil(120_000)
    expect(b.state()).toBe("open")
    expect(b.canRequest()).toBe(false)

    t = 100_000
    expect(b.canRequest()).toBe(false)
    t = 120_000
    expect(b.canRequest()).toBe(true)
    expect(b.state()).toBe("half-open")
  })

  it("openUntil takes the max of current expiry and the given time", () => {
    let t = 0
    const b = new PreviewSourceBreaker({ failureThreshold: 2, cooldownMs: 60_000, now: () => t })
    // trip open — expiry = 0 + 60_000
    b.recordFailure()
    b.recordFailure()

    // extend to t+200_000 — should override the shorter 60s cooldown
    b.openUntil(200_000)
    t = 60_000
    expect(b.canRequest()).toBe(false) // cooldown would have ended but openUntil extends it
    t = 200_000
    expect(b.canRequest()).toBe(true)
    expect(b.state()).toBe("half-open")
  })

  it("openUntil on a closed breaker forces open with the given expiry", () => {
    let t = 0
    const b = new PreviewSourceBreaker({ failureThreshold: 10, cooldownMs: 60_000, now: () => t })
    expect(b.state()).toBe("closed")
    b.openUntil(50_000)
    expect(b.state()).toBe("open")
    expect(b.canRequest()).toBe(false)
    t = 50_000
    expect(b.canRequest()).toBe(true)
  })

  it("recordSuccess always closes and resets, even when called while open", () => {
    const t = 0
    const b = new PreviewSourceBreaker({ failureThreshold: 2, cooldownMs: 60_000, now: () => t })
    b.recordFailure()
    b.recordFailure()
    expect(b.state()).toBe("open")

    b.recordSuccess()
    expect(b.state()).toBe("closed")
    expect(b.canRequest()).toBe(true)
  })
})
