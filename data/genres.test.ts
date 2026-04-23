/**
 * Tree-shape invariants the picker relies on. If any of these break, the
 * picker UI will either crash, show unselectable dead buttons, or route the
 * user to dead ends.
 */
import { describe, it, expect } from "vitest"
import type { GenreNode } from "@/lib/types"
import genreData from "./genres.json"

interface GenreData {
  generated: string
  source: string
  nodes: GenreNode[]
}

const data = genreData as GenreData

function walkDeep(node: GenreNode, fn: (n: GenreNode, depth: number) => void, depth = 0) {
  fn(node, depth)
  for (const child of node.children) walkDeep(child, fn, depth + 1)
}

describe("genres.json tree invariants", () => {
  it("every SUBCLUSTER_* node is navigation-only (empty lastfmTag)", () => {
    const offenders: string[] = []
    for (const anchor of data.nodes) {
      walkDeep(anchor, (n) => {
        if (n.id.startsWith("SUBCLUSTER_") && n.lastfmTag !== "") {
          offenders.push(`${n.id}: lastfmTag="${n.lastfmTag}"`)
        }
      })
    }
    expect(offenders).toEqual([])
  })

  it("every true leaf (children.length === 0) has a non-empty lastfmTag", () => {
    const offenders: string[] = []
    for (const anchor of data.nodes) {
      walkDeep(anchor, (n) => {
        if (n.children.length === 0 && !n.lastfmTag) offenders.push(n.id)
      })
    }
    expect(offenders).toEqual([])
  })

  it("leaf ids are globally unique (TAG_TO_ENTRY depends on this)", () => {
    const ids = new Set<string>()
    const dupes: string[] = []
    for (const anchor of data.nodes) {
      walkDeep(anchor, (n) => {
        if (ids.has(n.id)) dupes.push(n.id)
        ids.add(n.id)
      })
    }
    expect(dupes).toEqual([])
  })

  it("exposes at least one path of depth ≥ 4 (picker recursion must be exercised)", () => {
    let maxDepth = 0
    for (const anchor of data.nodes) {
      walkDeep(anchor, (_, d) => {
        if (d > maxDepth) maxDepth = d
      })
    }
    expect(maxDepth).toBeGreaterThanOrEqual(4)
  })

  it("all parent-child links are internally consistent", () => {
    const byId = new Map<string, GenreNode>()
    for (const anchor of data.nodes) walkDeep(anchor, (n) => byId.set(n.id, n))

    const broken: string[] = []
    for (const anchor of data.nodes) {
      walkDeep(anchor, (n) => {
        for (const child of n.children) {
          if (child.parentId !== n.id) {
            broken.push(`${child.id}.parentId=${child.parentId} but actual parent is ${n.id}`)
          }
        }
      })
    }
    expect(broken).toEqual([])
  })
})
