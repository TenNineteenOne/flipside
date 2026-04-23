import { describe, it, expect } from "vitest"
import { adjacencyScore, adjacentGenres, genreToAnchor } from "./adjacency"

describe("genreToAnchor", () => {
  it("returns the anchor id for a known leaf", () => {
    expect(genreToAnchor("indie-rock")).toBe("ANCHOR_rock")
  })

  it("folds format differences (normalize)", () => {
    expect(genreToAnchor("Indie Rock")).toBe("ANCHOR_rock")
    expect(genreToAnchor("indie_rock")).toBe("ANCHOR_rock")
    expect(genreToAnchor("INDIE-ROCK")).toBe("ANCHOR_rock")
  })

  it("resolves an anchor tag to its own anchor id", () => {
    expect(genreToAnchor("rock")).toBe("ANCHOR_rock")
    expect(genreToAnchor("hip-hop")).toBe("ANCHOR_hiphop")
  })

  it("returns null for unknown tags", () => {
    expect(genreToAnchor("completely-made-up-genre")).toBeNull()
  })
})

describe("adjacencyScore", () => {
  it("scores identical tags as 1.0", () => {
    expect(adjacencyScore("indie-rock", "indie-rock")).toBe(1.0)
    expect(adjacencyScore("indie-rock", "Indie Rock")).toBe(1.0)
  })

  it("scores close everynoise neighbours high (continuous, > 0.9)", () => {
    // indie-rock and indie-pop both have everynoise coords; should be
    // spatially close on the map.
    const s = adjacencyScore("indie-rock", "indie-pop")
    expect(s).toBeGreaterThan(0.9)
    expect(s).toBeLessThan(1.0)
  })

  it("scores distant 2D-map genres lower than near ones", () => {
    const near = adjacencyScore("indie-rock", "indie-pop")
    const far = adjacencyScore("indie-rock", "reggaeton")
    expect(near).toBeGreaterThan(far)
    expect(far).toBeLessThan(0.8)
  })

  it("returns 0 when a tag is unknown", () => {
    expect(adjacencyScore("indie-rock", "zzz-unknown")).toBe(0)
    expect(adjacencyScore("zzz-unknown", "indie-rock")).toBe(0)
  })

})

describe("adjacentGenres", () => {
  it("close: returns K nearest leaves by 2D distance (same anchor)", () => {
    const siblings = adjacentGenres("indie-rock", "close")
    expect(siblings.length).toBeGreaterThan(0)
    expect(siblings).not.toContain("indie-rock")
    // Every close sibling must share the rock anchor.
    for (const s of siblings) {
      expect(genreToAnchor(s)).toBe("ANCHOR_rock")
    }
  })

  it("close: does NOT pollute across anchors", () => {
    const siblings = adjacentGenres("indie-rock", "close")
    for (const s of siblings) {
      expect(genreToAnchor(s)).toBe("ANCHOR_rock")
    }
  })

  it("medium: returns leaves from OTHER anchors for discovery bleed", () => {
    const cousins = adjacentGenres("indie-rock", "medium")
    expect(cousins.length).toBeGreaterThan(0)
    for (const c of cousins) {
      const anchor = genreToAnchor(c)
      // Medium explicitly crosses anchors — none should be rock.
      expect(anchor).not.toBe("ANCHOR_rock")
    }
  })

  it("returns an empty array for unknown tags", () => {
    expect(adjacentGenres("zzz-unknown", "close")).toEqual([])
    expect(adjacentGenres("zzz-unknown", "medium")).toEqual([])
  })
})
