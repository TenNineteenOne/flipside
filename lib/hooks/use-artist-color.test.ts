/**
 * Tests for use-artist-color hook helpers.
 *
 * The vitest environment is "node" (no DOM / jsdom), so we test the exported
 * pure helper resolveArtistColor rather than rendering the hook via renderHook.
 *
 * sanitizeHex contract (from lib/color-utils.ts):
 *   - Valid 6-digit hex with "#" prefix → returned as-is.
 *   - null / undefined / empty / invalid → returns "#8b5cf6" (the fallback).
 *
 * resolveArtistColor contract:
 *   - When sanitizeHex returns "#8b5cf6" → return stringToVibrantHex(artistName).
 *   - When sanitizeHex returns a valid non-default hex → return that hex.
 */

import { describe, it, expect } from "vitest"
import { resolveArtistColor } from "./use-artist-color"
import { stringToVibrantHex } from "@/lib/color-utils"

const DEFAULT_SENTINEL = "#8b5cf6"

describe("resolveArtistColor", () => {
  it("returns name-hash color when rawColor is null", () => {
    const result = resolveArtistColor(null, "Radiohead")
    expect(result).toBe(stringToVibrantHex("Radiohead"))
    expect(result).not.toBe(DEFAULT_SENTINEL)
  })

  it("returns name-hash color when rawColor is undefined", () => {
    const result = resolveArtistColor(undefined, "Björk")
    expect(result).toBe(stringToVibrantHex("Björk"))
  })

  it("returns name-hash color when rawColor is empty string", () => {
    const result = resolveArtistColor("", "FKA twigs")
    expect(result).toBe(stringToVibrantHex("FKA twigs"))
  })

  it("returns name-hash color when rawColor is an invalid hex (sanitizeHex returns sentinel)", () => {
    const result = resolveArtistColor("notahex", "Portishead")
    expect(result).toBe(stringToVibrantHex("Portishead"))
  })

  it("returns name-hash color when rawColor is the default sentinel #8b5cf6 itself", () => {
    // The DB stores this sentinel when album art hasn't been processed yet.
    const result = resolveArtistColor("#8b5cf6", "Massive Attack")
    expect(result).toBe(stringToVibrantHex("Massive Attack"))
  })

  it("returns the sanitized color when rawColor is a valid non-default hex", () => {
    const result = resolveArtistColor("#1db954", "Spotify Test")
    expect(result).toBe("#1db954")
  })

  it("returns the sanitized color for another valid non-default hex", () => {
    const result = resolveArtistColor("#ff6b35", "The National")
    expect(result).toBe("#ff6b35")
  })

  it("is case-preserving for valid hex (sanitizeHex returns input as-is when valid)", () => {
    // sanitizeHex accepts uppercase hex and returns it unchanged
    const result = resolveArtistColor("#AABBCC", "Beach House")
    expect(result).toBe("#AABBCC")
  })
})
