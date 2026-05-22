/**
 * Tests for use-artist-tracks hook helpers.
 *
 * The vitest environment is "node" (no DOM / jsdom), so we test the exported
 * pure helpers that the hook composes rather than rendering the hook.
 *
 *   buildArtistTracksUrl      — URL construction and encoding
 *   extractTracksFromResponse — response shape parsing / validation
 */

import { describe, it, expect } from "vitest"
import { buildArtistTracksUrl, extractTracksFromResponse } from "./use-artist-tracks"
import type { Track } from "@/lib/music-provider/types"

// ─── buildArtistTracksUrl ─────────────────────────────────────────────────────

describe("buildArtistTracksUrl", () => {
  it("builds the correct URL for a plain artist ID and name", () => {
    expect(buildArtistTracksUrl("abc123", "Radiohead")).toBe(
      "/api/artists/abc123/tracks?name=Radiohead",
    )
  })

  it("URL-encodes the artist name (spaces)", () => {
    expect(buildArtistTracksUrl("xyz", "Nine Inch Nails")).toBe(
      "/api/artists/xyz/tracks?name=Nine%20Inch%20Nails",
    )
  })

  it("URL-encodes special characters in the artist name (accented chars)", () => {
    expect(buildArtistTracksUrl("id1", "Sigur Rós")).toBe(
      "/api/artists/id1/tracks?name=Sigur%20R%C3%B3s",
    )
  })

  it("URL-encodes artist name with slash", () => {
    const url = buildArtistTracksUrl("id2", "AC/DC")
    expect(url).toBe("/api/artists/id2/tracks?name=AC%2FDC")
  })
})

// ─── extractTracksFromResponse ────────────────────────────────────────────────

const sampleTrack: Track = {
  id: "t1",
  spotifyTrackId: null,
  name: "Creep",
  previewUrl: null,
  durationMs: 238000,
  albumName: "Pablo Honey",
  albumImageUrl: null,
  source: "spotify",
}

describe("extractTracksFromResponse", () => {
  it("returns the tracks array when data.tracks is non-empty", () => {
    const data = { tracks: [sampleTrack] }
    expect(extractTracksFromResponse(data)).toEqual([sampleTrack])
  })

  it("returns null when data.tracks is an empty array", () => {
    expect(extractTracksFromResponse({ tracks: [] })).toBeNull()
  })

  it("returns null when data has no tracks key", () => {
    expect(extractTracksFromResponse({ other: "stuff" })).toBeNull()
  })

  it("returns null when data is null", () => {
    expect(extractTracksFromResponse(null)).toBeNull()
  })

  it("returns null when data is a string", () => {
    expect(extractTracksFromResponse("not-an-object")).toBeNull()
  })

  it("returns null when data.tracks is not an array", () => {
    expect(extractTracksFromResponse({ tracks: "bad" })).toBeNull()
  })

  it("returns all tracks when data.tracks has multiple entries", () => {
    const track2: Track = { ...sampleTrack, id: "t2", name: "Karma Police" }
    const data = { tracks: [sampleTrack, track2] }
    const result = extractTracksFromResponse(data)
    expect(result).toHaveLength(2)
    expect(result![0].id).toBe("t1")
    expect(result![1].id).toBe("t2")
  })
})
