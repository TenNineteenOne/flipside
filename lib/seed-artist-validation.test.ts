import { describe, it, expect } from "vitest"
import { validateSeedArtists } from "@/lib/seed-artist-validation"

// Stage-2 identity: seed artist ids are internal uuids, not Spotify ids.
const UUID_A = "11111111-1111-4111-8111-111111111111"
const UUID_B = "22222222-2222-4222-9222-222222222222"

describe("validateSeedArtists", () => {
  it("keeps one entry per id (a repeated id fails the upsert with 21000 and double-counts the cap)", () => {
    const result = validateSeedArtists(
      [{ id: UUID_A, name: "One", imageUrl: null }, { id: UUID_B, name: "Two", imageUrl: null }, { id: UUID_A, name: "One again", imageUrl: null }],
      { min: 1, max: 10 },
    )
    expect(result.ok && result.artists.map((x) => x.name)).toEqual(["One", "Two"])
  })

  it("counts the minimum after de-duplicating", () => {
    const a = { id: UUID_A, name: "One", imageUrl: null }
    expect(validateSeedArtists([a, a, a], { min: 3, max: 10 }).ok).toBe(false)
  })

  it("rejects a NUL character, which Postgres text cannot store", () => {
    expect(validateSeedArtists([{ id: UUID_A, name: "a\u0000b", imageUrl: null }], { min: 1, max: 10 }).ok).toBe(false)
    expect(validateSeedArtists([{ id: UUID_A, name: "ab", imageUrl: "https://x.test/\u0000" }], { min: 1, max: 10 }).ok).toBe(false)
  })

  it("accepts a valid array of uuid-keyed artists", () => {
    const result = validateSeedArtists(
      [
        { id: UUID_A, name: "Artist One", imageUrl: "https://example.com/a.jpg" },
        { id: UUID_B, name: "Artist Two", imageUrl: null },
      ],
      { min: 1, max: 10 },
    )
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.artists).toEqual([
        { id: UUID_A, name: "Artist One", imageUrl: "https://example.com/a.jpg" },
        { id: UUID_B, name: "Artist Two", imageUrl: null },
      ])
    }
  })

  it("rejects a non-array input", () => {
    const result = validateSeedArtists({ id: UUID_A }, { min: 1, max: 10 })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain("array")
  })

  it("rejects too few entries", () => {
    const result = validateSeedArtists([], { min: 1, max: 10 })
    expect(result.ok).toBe(false)
  })

  it("rejects too many entries", () => {
    const many = Array.from({ length: 11 }, () => ({ id: UUID_A, name: "x", imageUrl: null }))
    const result = validateSeedArtists(many, { min: 1, max: 10 })
    expect(result.ok).toBe(false)
  })

  it("rejects a non-object entry", () => {
    const result = validateSeedArtists(["nope"], { min: 1, max: 10 })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toBe("each artist must be an object")
  })

  it("rejects an invalid artist id (Spotify-style base62 id is no longer valid)", () => {
    const result = validateSeedArtists(
      [{ id: "0OdUWJ0sBjDrqHygGUXeCF", name: "Band", imageUrl: null }],
      { min: 1, max: 10 },
    )
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toBe("invalid artist id")
  })

  it("rejects an id that is not a string", () => {
    const result = validateSeedArtists([{ id: 123, name: "Band", imageUrl: null }], { min: 1, max: 10 })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toBe("invalid artist id")
  })

  it("rejects a non-string name", () => {
    const result = validateSeedArtists([{ id: UUID_A, name: 5, imageUrl: null }], { min: 1, max: 10 })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toBe("artist name must be a string")
  })

  it("rejects an empty name", () => {
    const result = validateSeedArtists([{ id: UUID_A, name: "   ", imageUrl: null }], { min: 1, max: 10 })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toBe("artist name must be 1–200 chars")
  })

  it("trims the name", () => {
    const result = validateSeedArtists([{ id: UUID_A, name: "  Trimmed  ", imageUrl: null }], { min: 1, max: 10 })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.artists[0].name).toBe("Trimmed")
  })

  it("rejects a non-http imageUrl", () => {
    const result = validateSeedArtists(
      [{ id: UUID_A, name: "Band", imageUrl: "ftp://example.com/a.jpg" }],
      { min: 1, max: 10 },
    )
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain("imageUrl")
  })

  it("treats undefined imageUrl as null", () => {
    const result = validateSeedArtists([{ id: UUID_A, name: "Band" }], { min: 1, max: 10 })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.artists[0].imageUrl).toBeNull()
  })
})
