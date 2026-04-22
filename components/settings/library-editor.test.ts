import { describe, it, expect } from "vitest"
import type { GenreNode } from "@/lib/types"
import { normalizeGenre } from "@/lib/genre/normalize"
import { buildTagLookup } from "./library-editor"

function leaf(lastfmTag: string, id = lastfmTag, label = lastfmTag): GenreNode {
  return { id, label, lastfmTag, parentId: null, children: [] }
}

function nav(id: string, children: GenreNode[]): GenreNode {
  return { id, label: id, lastfmTag: "", parentId: null, children }
}

describe("buildTagLookup", () => {
  it("map is keyed on normalized form; stored tags resolve across hyphen/space/underscore/case", () => {
    const tree: GenreNode[] = [leaf("indie-rock"), leaf("hip hop"), leaf("K_Pop")]
    const lookup = buildTagLookup(tree)

    // Any stored format, normalized on the way in, resolves to the same node.
    expect(lookup.get(normalizeGenre("indie-rock"))?.lastfmTag).toBe("indie-rock")
    expect(lookup.get(normalizeGenre("Indie Rock"))?.lastfmTag).toBe("indie-rock")
    expect(lookup.get(normalizeGenre("indie_rock"))?.lastfmTag).toBe("indie-rock")
    expect(lookup.get(normalizeGenre("hip-hop"))?.lastfmTag).toBe("hip hop")
    expect(lookup.get(normalizeGenre("k-pop"))?.lastfmTag).toBe("K_Pop")
  })

  it("skips navigation-only nodes (empty lastfmTag) but walks their children", () => {
    const tree: GenreNode[] = [nav("SUBCLUSTER_x", [leaf("post-rock")])]
    const lookup = buildTagLookup(tree)

    expect(lookup.size).toBe(1)
    expect(lookup.get(normalizeGenre("post-rock"))?.lastfmTag).toBe("post-rock")
  })

  it("does not overwrite: first lastfmTag wins when two leaves normalize equal", () => {
    const tree: GenreNode[] = [leaf("indie-rock", "id-a"), leaf("indie rock", "id-b")]
    const lookup = buildTagLookup(tree)

    expect(lookup.get(normalizeGenre("indie rock"))?.id).toBe("id-a")
  })

  it("returns undefined for tags absent from the tree (orphan detection)", () => {
    const tree: GenreNode[] = [leaf("indie-rock")]
    const lookup = buildTagLookup(tree)

    expect(lookup.get(normalizeGenre("obsolete-genre-name"))).toBeUndefined()
  })
})
