import { describe, it, expect, beforeEach } from "vitest"
import {
  incItunes,
  incSpotify,
  incLastfmSimilar,
  incLastfmGetInfo,
  incLastfmTag,
  incLastfmSearch,
  snapshotCalls,
  resetCalls,
} from "./api-call-counter"

/** The all-zero Last.fm sub-snapshot, for concise expectations. */
const ZERO_LASTFM = { similar: 0, getInfo: 0, tag: 0, search: 0, total: 0 }

describe("api-call-counter", () => {
  beforeEach(() => {
    resetCalls()
  })

  it("starts at zero after reset", () => {
    expect(snapshotCalls()).toEqual({ itunes: 0, spotify: 0, lastfm: ZERO_LASTFM })
  })

  it("resetCalls zeroes every counter", () => {
    incItunes()
    incSpotify()
    incLastfmSimilar()
    incLastfmGetInfo()
    incLastfmTag()
    incLastfmSearch()
    resetCalls()
    expect(snapshotCalls()).toEqual({ itunes: 0, spotify: 0, lastfm: ZERO_LASTFM })
  })

  it("incItunes increments only the iTunes counter", () => {
    incItunes()
    incItunes()
    expect(snapshotCalls()).toEqual({ itunes: 2, spotify: 0, lastfm: ZERO_LASTFM })
  })

  it("incSpotify increments only the Spotify counter", () => {
    incSpotify()
    incSpotify()
    incSpotify()
    expect(snapshotCalls()).toEqual({ itunes: 0, spotify: 3, lastfm: ZERO_LASTFM })
  })

  it("incItunes and incSpotify increment independently", () => {
    incItunes()
    incSpotify()
    incSpotify()
    incItunes()
    incItunes()
    expect(snapshotCalls()).toEqual({ itunes: 3, spotify: 2, lastfm: ZERO_LASTFM })
  })

  it("each Last.fm endpoint increments only its own counter", () => {
    incLastfmSimilar()
    expect(snapshotCalls().lastfm).toEqual({ similar: 1, getInfo: 0, tag: 0, search: 0, total: 1 })

    resetCalls()
    incLastfmGetInfo()
    expect(snapshotCalls().lastfm).toEqual({ similar: 0, getInfo: 1, tag: 0, search: 0, total: 1 })

    resetCalls()
    incLastfmTag()
    expect(snapshotCalls().lastfm).toEqual({ similar: 0, getInfo: 0, tag: 1, search: 0, total: 1 })

    resetCalls()
    incLastfmSearch()
    expect(snapshotCalls().lastfm).toEqual({ similar: 0, getInfo: 0, tag: 0, search: 1, total: 1 })
  })

  it("lastfm.total is the sum across all four endpoints", () => {
    incLastfmSimilar()
    incLastfmSimilar()
    incLastfmGetInfo()
    incLastfmTag()
    incLastfmTag()
    incLastfmTag()
    incLastfmSearch()
    expect(snapshotCalls().lastfm).toEqual({ similar: 2, getInfo: 1, tag: 3, search: 1, total: 7 })
  })

  it("Last.fm counters are independent of iTunes / Spotify", () => {
    incItunes()
    incSpotify()
    incLastfmSimilar()
    expect(snapshotCalls()).toEqual({
      itunes: 1,
      spotify: 1,
      lastfm: { similar: 1, getInfo: 0, tag: 0, search: 0, total: 1 },
    })
  })

  it("snapshotCalls returns current totals (monotonic)", () => {
    incItunes()
    const snap1 = snapshotCalls()
    incLastfmTag()
    const snap2 = snapshotCalls()
    expect(snap1).toEqual({ itunes: 1, spotify: 0, lastfm: ZERO_LASTFM })
    expect(snap2).toEqual({
      itunes: 1,
      spotify: 0,
      lastfm: { similar: 0, getInfo: 0, tag: 1, search: 0, total: 1 },
    })
  })
})
