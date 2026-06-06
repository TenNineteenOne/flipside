import { describe, it, expect, beforeEach } from "vitest"
import { incItunes, incSpotify, snapshotCalls, resetCalls } from "./api-call-counter"

describe("api-call-counter", () => {
  beforeEach(() => {
    resetCalls()
  })

  it("starts at zero after reset", () => {
    expect(snapshotCalls()).toEqual({ itunes: 0, spotify: 0 })
  })

  it("resetCalls zeroes both counters", () => {
    incItunes()
    incSpotify()
    resetCalls()
    expect(snapshotCalls()).toEqual({ itunes: 0, spotify: 0 })
  })

  it("incItunes increments only the iTunes counter", () => {
    incItunes()
    incItunes()
    expect(snapshotCalls()).toEqual({ itunes: 2, spotify: 0 })
  })

  it("incSpotify increments only the Spotify counter", () => {
    incSpotify()
    incSpotify()
    incSpotify()
    expect(snapshotCalls()).toEqual({ itunes: 0, spotify: 3 })
  })

  it("incItunes and incSpotify increment independently", () => {
    incItunes()
    incSpotify()
    incSpotify()
    incItunes()
    incItunes()
    expect(snapshotCalls()).toEqual({ itunes: 3, spotify: 2 })
  })

  it("snapshotCalls returns current totals (monotonic)", () => {
    incItunes()
    const snap1 = snapshotCalls()
    incSpotify()
    const snap2 = snapshotCalls()
    expect(snap1).toEqual({ itunes: 1, spotify: 0 })
    expect(snap2).toEqual({ itunes: 1, spotify: 1 })
  })
})
