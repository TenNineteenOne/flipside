import { describe, it, expect, vi, beforeEach } from "vitest"
import type { GenreNode } from "@/lib/types"
import { normalizeGenre } from "@/lib/genre/normalize"

const patchSettings = vi.fn<(p: unknown, o?: { signal?: AbortSignal }) => Promise<void>>(async () => {})
vi.mock("@/lib/settings/patch-settings", async (orig) => ({
  ...(await orig<typeof import("@/lib/settings/patch-settings")>()),
  patchSettings: (p: unknown, o?: { signal?: AbortSignal }) => patchSettings(p, o),
}))
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { error: vi.fn(), info: vi.fn() }) }))

import { buildTagLookup, createGenreWriter } from "./library-editor"

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

describe("createGenreWriter", () => {
  beforeEach(() => patchSettings.mockReset())
  const a = [leaf("a")]
  const ab = [leaf("a"), leaf("b")]
  const abc = [leaf("a"), leaf("b"), leaf("c")]

  it("a failed save rolls back to the last list the server confirmed", async () => {
    const rollback = vi.fn()
    const write = createGenreWriter(a, rollback)
    await write(ab)
    expect(patchSettings).toHaveBeenLastCalledWith({ selectedGenres: ["a", "b"] }, expect.anything())
    patchSettings.mockRejectedValueOnce(new Error("500"))
    await write(abc)
    expect(rollback).toHaveBeenCalledExactlyOnceWith(ab)
  })

  it("a failure while a newer pick is waiting doesn't roll back; the newer save sends the whole list", async () => {
    const rollback = vi.fn()
    const write = createGenreWriter(a, rollback)
    patchSettings.mockRejectedValueOnce(new Error("500"))
    const first = write(ab)
    write.supersede() // second pick, still inside the debounce
    await first
    await write(abc)
    expect(rollback).not.toHaveBeenCalled()
    expect(patchSettings).toHaveBeenLastCalledWith({ selectedGenres: ["a", "b", "c"] }, expect.anything())
    patchSettings.mockRejectedValueOnce(new Error("500"))
    await write(a)
    expect(rollback).toHaveBeenCalledExactlyOnceWith(abc) // the second save became the confirmed list
  })

  it("a newer save aborts the one in flight, and the abort is not treated as a failure", async () => {
    const rollback = vi.fn()
    const write = createGenreWriter(a, rollback)
    patchSettings.mockImplementationOnce((_p, o) => new Promise((_, reject) => {
      o!.signal!.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })))
    }))
    const first = write(ab)
    await write(abc)
    await first
    expect(rollback).not.toHaveBeenCalled()
  })
})
