import { describe, it, expect, vi } from "vitest"
import { allLeavesWithAnchor, genreToAnchor, listAnchors } from "@/lib/genre/adjacency"
import {
  FAR_RESOLVE_CAP,
  FAR_TAG_CALLS,
  computeTopAnchors,
  fetchFarNames,
  leftfieldTags,
  midListStart,
  outsideTags,
} from "./far-picks"

const names = (tag: string, n: number) => Array.from({ length: n }, (_, i) => `${tag}#${i}`)

describe("fetchFarNames", () => {
  it("makes at most FAR_TAG_CALLS tag lookups and caps the pool", async () => {
    const fetchTagArtists = vi.fn(async (tag: string, limit: number) => names(tag, limit))
    const out = await fetchFarNames({ selectedGenres: [], listened: [], seed: 42, fetchTagArtists })
    expect(fetchTagArtists.mock.calls.length).toBeLessThanOrEqual(FAR_TAG_CALLS)
    expect(FAR_TAG_CALLS).toBeLessThanOrEqual(8)
    expect(out.length).toBeLessThanOrEqual(FAR_RESOLVE_CAP)
    expect(out.length).toBeGreaterThan(0)
    expect(new Set(out.map((f) => f.name.toLowerCase())).size).toBe(out.length)
    for (const f of out) expect(f.label).toBeTruthy()
  })

  it("skips the mainstream head (positions 0–9) of each tag list", async () => {
    const out = await fetchFarNames({
      selectedGenres: [],
      listened: [],
      seed: 7,
      fetchTagArtists: async (tag, limit) => names(tag, limit),
    })
    for (const f of out) expect(Number(f.name.split("#")[1])).toBeGreaterThanOrEqual(10)
  })

  it("round-robins across tags so the first picks come from different tags", async () => {
    const out = await fetchFarNames({
      selectedGenres: [],
      listened: [],
      seed: 3,
      fetchTagArtists: async (tag, limit) => names(tag, limit),
    })
    const firstTags = out.slice(0, 4).map((f) => f.name.split("#")[0])
    expect(new Set(firstTags).size).toBe(4)
  })

  it("never throws: a failing tag contributes nothing", async () => {
    const out = await fetchFarNames({
      selectedGenres: [],
      listened: [],
      seed: 1,
      fetchTagArtists: async () => {
        throw new Error("lastfm down")
      },
    })
    expect(out).toEqual([])
  })
})

describe("tag pickers", () => {
  it("outsideTags avoids anchors the user selected", () => {
    const anchors = listAnchors()
    const selected = anchors.slice(0, 3).map((a) => a.lastfmTag)
    const picked = outsideTags(selected, [], 9)
    expect(picked.length).toBeGreaterThan(0)
    const selectedAnchors = new Set(selected.map((g) => genreToAnchor(g)))
    const labelsOfSelected = new Set(anchors.filter((a) => selectedAnchors.has(a.id)).map((a) => a.label))
    for (const p of picked) expect(labelsOfSelected.has(p.label)).toBe(false)
  })

  it("leftfieldTags excludes the user's top-2 listened anchors and de-hyphenates labels", () => {
    const leaves = allLeavesWithAnchor()
    const anchorIds = [...new Set(leaves.map((l) => l.anchorId))]
    const leafOf = (id: string) => leaves.find((l) => l.anchorId === id)!.lastfmTag
    const listened = [
      { play_count: 100, genres: [leafOf(anchorIds[0])] },
      { play_count: 50, genres: [leafOf(anchorIds[1])] },
    ]
    const top = computeTopAnchors(listened)
    expect(top).toHaveLength(2)
    for (let seed = 0; seed < 20; seed++) {
      for (const t of leftfieldTags(listened, seed)) {
        expect(top).not.toContain(leaves.find((l) => l.lastfmTag === t.tag)!.anchorId)
        expect(t.label).not.toContain("-")
      }
    }
  })

  it("midListStart stays in range for seeds past Int32", () => {
    for (const seed of [0, 2 ** 31 + 5, 2 ** 32 - 1]) {
      const i = midListStart(seed, "dutch-black-metal", 7)
      expect(i).toBeGreaterThanOrEqual(0)
      expect(i).toBeLessThan(7)
    }
  })
})
