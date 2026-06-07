import { describe, it, expect } from "vitest"
import { isValidSpotifyId, isValidArtistId } from "./spotify-ids"

describe("isValidSpotifyId", () => {
  it("accepts a 22-char base62 id", () => {
    expect(isValidSpotifyId("4Z8W4fKeB5YxbusRsdQVPb")).toBe(true)
  })
  it("rejects wrong length and non-base62", () => {
    expect(isValidSpotifyId("tooshort")).toBe(false)
    expect(isValidSpotifyId("4Z8W4fKeB5YxbusRsdQVP-")).toBe(false) // hyphen not base62
  })
})

describe("isValidArtistId (UUID v4)", () => {
  it("accepts a valid lowercase v4 uuid", () => {
    expect(isValidArtistId("f47ac10b-58cc-4372-a567-0e02b2c3d479")).toBe(true)
    expect(isValidArtistId("550e8400-e29b-41d4-a716-446655440000")).toBe(true)
  })

  it("rejects a Spotify id (no dashes, wrong shape)", () => {
    expect(isValidArtistId("4Z8W4fKeB5YxbusRsdQVPb")).toBe(false)
  })

  it("rejects uppercase (must be lowercase)", () => {
    expect(isValidArtistId("F47AC10B-58CC-4372-A567-0E02B2C3D479")).toBe(false)
  })

  it("rejects the wrong version or variant nibble", () => {
    // version nibble must be 4
    expect(isValidArtistId("f47ac10b-58cc-1372-a567-0e02b2c3d479")).toBe(false)
    // variant nibble must be 8/9/a/b
    expect(isValidArtistId("f47ac10b-58cc-4372-7567-0e02b2c3d479")).toBe(false)
  })

  it("rejects path-traversal / injection strings", () => {
    expect(isValidArtistId("../../etc/passwd")).toBe(false)
    expect(isValidArtistId("f47ac10b-58cc-4372-a567-0e02b2c3d479/../..")).toBe(false)
    expect(isValidArtistId("")).toBe(false)
    expect(isValidArtistId("not-a-uuid")).toBe(false)
  })

  it("rejects extra surrounding whitespace / chars (anchored)", () => {
    expect(isValidArtistId(" f47ac10b-58cc-4372-a567-0e02b2c3d479")).toBe(false)
    expect(isValidArtistId("f47ac10b-58cc-4372-a567-0e02b2c3d479 ")).toBe(false)
  })
})
