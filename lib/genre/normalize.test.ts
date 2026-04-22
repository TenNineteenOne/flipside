import { describe, it, expect } from "vitest"
import { normalizeGenre, normalizedEquals, normalizedIncludes } from "./normalize"

describe("normalizeGenre", () => {
  it("lowercases", () => {
    expect(normalizeGenre("Indie Rock")).toBe("indie rock")
  })

  it("treats hyphens, underscores, and spaces equivalently", () => {
    expect(normalizeGenre("indie-rock")).toBe("indie rock")
    expect(normalizeGenre("indie_rock")).toBe("indie rock")
    expect(normalizeGenre("indie rock")).toBe("indie rock")
  })

  it("collapses whitespace and trims", () => {
    expect(normalizeGenre("  indie   rock  ")).toBe("indie rock")
  })

  it("handles empty strings without error", () => {
    expect(normalizeGenre("")).toBe("")
  })

  it("normalizes the Spotify / Last.fm / user-stored trio to one value", () => {
    const spotify = "Indie Rock"
    const lastfm = "indie-rock"
    const stored = "indie_rock"
    expect(normalizeGenre(spotify)).toBe(normalizeGenre(lastfm))
    expect(normalizeGenre(lastfm)).toBe(normalizeGenre(stored))
  })

  it("folds mixed hyphen/underscore patterns", () => {
    expect(normalizeGenre("hip-hop")).toBe("hip hop")
    expect(normalizeGenre("HipHop")).toBe("hiphop")
    expect(normalizeGenre("Hip Hop")).toBe("hip hop")
  })
})

describe("normalizedEquals", () => {
  it("returns true for format-only differences", () => {
    expect(normalizedEquals("Hip-Hop", "hip hop")).toBe(true)
    expect(normalizedEquals("hip-hop", "hip_hop")).toBe(true)
  })

  it("returns false for different genres", () => {
    expect(normalizedEquals("rock", "pop")).toBe(false)
  })

  it("distinguishes squashed-together tokens", () => {
    // "HipHop" has no separator, so it normalizes to "hiphop" — distinct from "hip hop".
    // This is intentional: we don't strip word boundaries, only normalize them.
    expect(normalizedEquals("HipHop", "hip-hop")).toBe(false)
  })
})

describe("normalizedIncludes", () => {
  it("substring match across formats", () => {
    expect(normalizedIncludes("indie-rock", "rock")).toBe(true)
    expect(normalizedIncludes("garage rock", "rock")).toBe(true)
    expect(normalizedIncludes("Indie Rock", "ROCK")).toBe(true)
  })

  it("matches the canonical bug case: hip-hop vs hip hop", () => {
    expect(normalizedIncludes("hip-hop", "hip hop")).toBe(true)
    expect(normalizedIncludes("Hip-Hop", "hip hop")).toBe(true)
    expect(normalizedIncludes("hip_hop", "hip-hop")).toBe(true)
  })

  it("returns false when the needle is absent", () => {
    expect(normalizedIncludes("pop", "rock")).toBe(false)
  })

  it("empty needle matches anything (preserves Array.some default semantics)", () => {
    expect(normalizedIncludes("anything", "")).toBe(true)
  })
})
