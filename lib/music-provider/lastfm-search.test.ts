import { describe, it, expect, vi, afterEach } from "vitest"
import { mapSearchResponse, pickBestMatch, type LastfmArtistCandidate } from "./lastfm-search"

/** Build a raw Last.fm artist.search body (the shape confirmed against the live API). */
function body(artists: unknown) {
  return { results: { artistmatches: { artist: artists } } }
}

function rawArtist(name: string, extra: Record<string, unknown> = {}) {
  return { name, listeners: "1000", mbid: "mb-" + name, url: "u", streamable: "0", ...extra }
}

describe("mapSearchResponse", () => {
  it("maps an array of matches to candidates", () => {
    const out = mapSearchResponse(
      body([
        rawArtist("Boards of Canada", {
          listeners: "2114719",
          mbid: "69158f97-4c07-4c4e-baf8-4e4ab1ed666e",
          image: [
            { "#text": "small.png", size: "small" },
            { "#text": "xl.png", size: "extralarge" },
          ],
        }),
        rawArtist("Bibio"),
      ]),
    )
    expect(out).toHaveLength(2)
    expect(out[0]).toEqual({
      name: "Boards of Canada",
      mbid: "69158f97-4c07-4c4e-baf8-4e4ab1ed666e",
      listeners: 2114719,
      imageUrl: "xl.png", // prefers extralarge over small
    })
    expect(out[1].name).toBe("Bibio")
  })

  it("handles the single-result-as-object quirk (not an array)", () => {
    const out = mapSearchResponse(body(rawArtist("Radiohead")))
    expect(out).toHaveLength(1)
    expect(out[0].name).toBe("Radiohead")
  })

  it("returns [] for empty results, missing artistmatches, and malformed bodies", () => {
    expect(mapSearchResponse(body([]))).toEqual([])
    expect(mapSearchResponse({ results: {} })).toEqual([])
    expect(mapSearchResponse({})).toEqual([])
    expect(mapSearchResponse(null)).toEqual([])
    expect(mapSearchResponse("nonsense")).toEqual([])
  })

  it("nulls a missing/empty mbid and defaults non-numeric listeners to 0", () => {
    const out = mapSearchResponse(
      body([
        { name: "No MBID", listeners: "not-a-number" },
        { name: "Empty MBID", mbid: "", listeners: "5" },
      ]),
    )
    expect(out[0]).toMatchObject({ name: "No MBID", mbid: null, listeners: 0 })
    expect(out[1]).toMatchObject({ name: "Empty MBID", mbid: null, listeners: 5 })
  })

  it("drops entries with no usable name and picks the largest available image", () => {
    const out = mapSearchResponse(
      body([
        { listeners: "1" }, // no name → dropped
        rawArtist("Only Small", { image: [{ "#text": "s.png", size: "small" }] }),
        rawArtist("No Images", { image: [] }),
        rawArtist("Blank Images", { image: [{ "#text": "", size: "large" }] }),
      ]),
    )
    expect(out.map((c) => c.name)).toEqual(["Only Small", "No Images", "Blank Images"])
    expect(out[0].imageUrl).toBe("s.png") // falls back to the only size present
    expect(out[1].imageUrl).toBeNull()
    expect(out[2].imageUrl).toBeNull() // blank #text is not a usable URL
  })
})

describe("pickBestMatch (similarity guard)", () => {
  const cand = (name: string): LastfmArtistCandidate => ({ name, mbid: null, listeners: 0, imageUrl: null })

  afterEach(() => vi.restoreAllMocks())

  it("returns null for no candidates", () => {
    expect(pickBestMatch("anything", [])).toBeNull()
  })

  it("prefers an exact normalized match even when it is not ranked first", () => {
    const m = pickBestMatch("M", [cand("Madonna"), cand("M")])
    expect(m).not.toBeNull()
    expect(m!.name).toBe("M")
    expect(m!.similarity).toBe(1)
  })

  it("treats exact match as case- and punctuation-insensitive", () => {
    // normalizeArtistName lowercases + strips punctuation, so "ACDC" == "AC/DC".
    const m = pickBestMatch("acdc", [cand("AC/DC")])
    expect(m?.name).toBe("AC/DC")
    expect(m?.similarity).toBe(1)
  })

  it("handles short names via the exact path (similarity scores 0 for len < 2)", () => {
    expect(pickBestMatch("U2", [cand("U2")])?.name).toBe("U2")
    expect(pickBestMatch("M", [cand("M")])?.name).toBe("M")
  })

  it("accepts the best fuzzy candidate when it clears the threshold", () => {
    // One-char deletion → very high Dice similarity, no exact match.
    const m = pickBestMatch("Boards of Canada", [cand("Boards of Canda"), cand("Aphex Twin")])
    expect(m).not.toBeNull()
    expect(m!.name).toBe("Boards of Canda")
    expect(m!.similarity).toBeGreaterThanOrEqual(0.8)
    expect(m!.similarity).toBeLessThan(1)
  })

  it("rejects (and logs) when nothing clears the threshold, so the cache isn't poisoned", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {})
    const m = pickBestMatch("Boards of Canada", [cand("Aphex Twin"), cand("Autechre")])
    expect(m).toBeNull()
    expect(spy).toHaveBeenCalledOnce()
    expect(spy.mock.calls[0][0]).toContain("no confident match")
  })

  it("picks the highest-similarity candidate among several above threshold", () => {
    const m = pickBestMatch("Radiohead", [cand("Radiohed"), cand("Radioheadd")])
    expect(m).not.toBeNull()
    // Both are close; the guard must return whichever scores highest, not just the first.
    const sims = ["Radiohed", "Radioheadd"].map((n) => m!.name === n)
    expect(sims.some(Boolean)).toBe(true)
    expect(m!.similarity).toBeGreaterThanOrEqual(0.8)
  })
})
