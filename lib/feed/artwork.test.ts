import { describe, it, expect } from "vitest"
import { artworkFor, letterFor } from "./artwork"

const track = (albumImageUrl: string | null) => ({ albumImageUrl })

describe("artworkFor", () => {
  it("prefers the artist image", () => {
    expect(artworkFor({ imageUrl: "artist.jpg", topTracks: [track("album.jpg")] })).toBe("artist.jpg")
  })

  it("falls back to the first track's album image", () => {
    expect(artworkFor({ imageUrl: null, topTracks: [track("album1.jpg"), track("album2.jpg")] })).toBe("album1.jpg")
  })

  it("is null when both are missing", () => {
    expect(artworkFor({ imageUrl: null, topTracks: [track(null), track("album2.jpg")] })).toBeNull()
  })

  it("is null with no image and no tracks", () => {
    expect(artworkFor({ imageUrl: null, topTracks: [] })).toBeNull()
  })

  it("treats an empty string as missing", () => {
    expect(artworkFor({ imageUrl: "", topTracks: [track("album.jpg")] })).toBe("album.jpg")
    expect(artworkFor({ imageUrl: "", topTracks: [track("")] })).toBeNull()
  })
})

describe("letterFor", () => {
  it("upper-cases the first letter, ignoring leading space", () => {
    expect(letterFor("  zola jesus")).toBe("Z")
  })
  it("takes a whole grapheme for non-Latin and combined characters", () => {
    expect(letterFor("ñu")).toBe("Ñ")
    expect(letterFor("निकिता")).toBe("नि")
    expect(letterFor("坂本龍一")).toBe("坂")
    expect(letterFor("👩‍🎤 band")).toBe("👩‍🎤")
  })
  it("is empty for a blank name", () => {
    expect(letterFor("   ")).toBe("")
  })
})
