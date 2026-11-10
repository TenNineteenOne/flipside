import { describe, it, expect } from "vitest"
import { afterEach, vi } from "vitest"
import { artworkAt, artworkFor, letterFor, NO_LETTER } from "./artwork"

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
  afterEach(() => vi.unstubAllGlobals())

  it("upper-cases the first letter, ignoring leading space", () => {
    expect(letterFor("  zola jesus")).toBe("Z")
  })
  it("takes a whole grapheme for non-Latin and combined characters", () => {
    expect(letterFor("ñu")).toBe("Ñ")
    expect(letterFor("निकिता")).toBe("नि")
    expect(letterFor("坂本龍一")).toBe("坂")
  })
  it("skips leading characters that are not a letter or number", () => {
    expect(letterFor("\u200Bzola")).toBe("Z")
    expect(letterFor("“Weird Al”")).toBe("W")
    expect(letterFor("...and you will know us")).toBe("A")
    expect(letterFor("👩‍🎤 band")).toBe("B")
    expect(letterFor("!!!")).toBe("!")
    expect(letterFor("2pac")).toBe("2")
  })
  it("falls back to the first visible grapheme, then a neutral symbol", () => {
    expect(letterFor("👩‍🎤")).toBe("👩‍🎤")
    expect(letterFor("   ")).toBe(NO_LETTER)
    expect(letterFor("\u200B\u200B")).toBe(NO_LETTER)
  })
  it("keeps one grapheme and ignores the browser locale when upper-casing", () => {
    expect(letterFor("ßtreet")).toBe("ß")
    expect(letterFor("ﬁve")).toBe("ﬁ")
    expect(letterFor("istanbul")).toBe("I")
  })
  it("works without Intl.Segmenter (Firefox before 125)", () => {
    vi.stubGlobal("Intl", { ...Intl, Segmenter: undefined })
    expect(letterFor("  zola")).toBe("Z")
    expect(letterFor("坂本")).toBe("坂")
    expect(letterFor("   ")).toBe(NO_LETTER)
  })
})

describe("artworkAt", () => {
  const apple = "https://is1-ssl.mzstatic.com/image/thumb/Music125/v4/33/c6/9c/33c69c01/7640159732259_cover.jpg/600x600bb.jpg"

  it("asks Apple's CDN for twice the display size", () => {
    expect(artworkAt(apple, 48)).toBe(apple.replace("600x600bb.jpg", "96x96bb.jpg"))
    expect(artworkAt(apple, 44)).toBe(apple.replace("600x600bb.jpg", "88x88bb.jpg"))
    expect(artworkAt(apple.replace(".jpg/600x600bb.jpg", ".png/600x600bb.png"), 40)).toMatch(/\.png\/80x80bb\.png$/)
    expect(artworkAt(apple.replace("is1-ssl", "is4-ssl"), 36)).toMatch(/\/72x72bb\.jpg$/)
  })

  it("never upscales past the stored size", () => {
    expect(artworkAt(apple, 600)).toBe(apple)
    expect(artworkAt(apple, 300)).toBe(apple)
    const small = apple.replace("600x600bb", "100x100bb")
    expect(artworkAt(small, 96)).toBe(small)
  })

  it("leaves other URLs and shapes alone", () => {
    const spotify = "https://i.scdn.co/image/ab6761610000e5eb1234567890abcdef12345678"
    expect(artworkAt(spotify, 48)).toBe(spotify)
    expect(artworkAt(null, 48)).toBeNull()
    expect(artworkAt("", 48)).toBe("")
    expect(artworkAt("not a url/600x600bb.jpg", 48)).toBe("not a url/600x600bb.jpg")
    // An mzstatic URL without a size suffix, and a lookalike host.
    expect(artworkAt("https://is1-ssl.mzstatic.com/image/thumb/x.jpg", 48)).toBe("https://is1-ssl.mzstatic.com/image/thumb/x.jpg")
    expect(artworkAt("https://evil.example/mzstatic.com/600x600bb.jpg", 48)).toBe("https://evil.example/mzstatic.com/600x600bb.jpg")
    expect(artworkAt("https://mzstatic.com.evil.example/a/600x600bb.jpg", 48)).toBe("https://mzstatic.com.evil.example/a/600x600bb.jpg")
  })
})
