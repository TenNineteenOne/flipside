import { describe, expect, it } from "vitest"
import full from "@/data/genres.json"
import slim from "@/data/genres-picker.json"
import type { GenreNode } from "@/lib/types"
import { createGenreGraph } from "./genre-graph"
import { decodePickerTree, encodePickerTree, slimGenreTree, type PickerData } from "./picker-data"
import { ALL_GENRES } from "@/components/onboarding/genre-picker"
import { buildTagLookup } from "@/components/settings/library-editor"

const FULL = (full as { nodes: GenreNode[] }).nodes
const SLIM = decodePickerTree(slim as PickerData)

function* walk(nodes: GenreNode[], anchor?: GenreNode): Generator<{ node: GenreNode; anchor: GenreNode }> {
  for (const n of nodes) {
    yield { node: n, anchor: anchor ?? n }
    yield* walk(n.children, anchor ?? n)
  }
}

describe("data/genres-picker.json", () => {
  it("is in sync with data/genres.json (run `npm run build:genres-picker`)", () => {
    expect(slim).toEqual(encodePickerTree(slimGenreTree(FULL)))
  })

  it("decodes to exactly the slim tree", () => {
    expect(SLIM).toEqual(slimGenreTree(FULL))
  })

  it("is what the genre picker ships", () => {
    expect(ALL_GENRES).toEqual(SLIM)
  })

  it("keeps every field the picker and the graph read, node for node", () => {
    const a = [...walk(FULL)]
    const b = [...walk(SLIM)]
    expect(b).toHaveLength(a.length)
    a.forEach(({ node, anchor }, i) => {
      const s = b[i]
      expect([s.node.id, s.node.label, s.node.lastfmTag, s.node.children.length, s.node.x, s.node.y, s.anchor.id]).toEqual([
        node.id, node.label, node.lastfmTag, node.children.length, node.x, node.y, anchor.id,
      ])
      expect(Object.keys(s.node).every((k) => ["id", "label", "lastfmTag", "children", "x", "y"].includes(k))).toBe(true)
    })
  })

  it("gives the same tag lookup (Settings' saved genres) as the full tree", () => {
    const fromFull = buildTagLookup(FULL)
    const fromSlim = buildTagLookup(SLIM)
    expect([...fromSlim.keys()]).toEqual([...fromFull.keys()])
    for (const [k, n] of fromFull) expect(fromSlim.get(k)!.id).toBe(n.id)
  })

  it("gives the same adjacency as the full tree", () => {
    const g1 = createGenreGraph(FULL)
    const g2 = createGenreGraph(SLIM)
    expect(g2.listAnchors()).toEqual(g1.listAnchors())
    expect(g2.allLeavesWithAnchor()).toEqual(g1.allLeavesWithAnchor())
    const nodes = [...walk(FULL)].map((w) => w.node)
    for (const n of nodes) {
      expect(g2.adjacentGenres(n.lastfmTag, "close")).toEqual(g1.adjacentGenres(n.lastfmTag, "close"))
      expect(g2.adjacentGenres(n.lastfmTag, "medium")).toEqual(g1.adjacentGenres(n.lastfmTag, "medium"))
      expect(g2.genreToAnchor(n.lastfmTag)).toBe(g1.genreToAnchor(n.lastfmTag))
    }
    expect(nodes.length).toBeGreaterThan(6000)
  }, 60_000)
})
