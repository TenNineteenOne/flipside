import { describe, it, expect, vi, beforeEach } from "vitest"
import { createFakeSupabase } from "@/lib/recommendation/__fixtures__/fake-supabase"

const invalidateExploreCache = vi.fn<(userId: string, rails?: string[]) => Promise<void>>()
vi.mock("@/lib/recommendation/explore-engine", () => ({
  invalidateExploreCache: (userId: string, rails?: string[]) => invalidateExploreCache(userId, rails),
}))

import { invalidationFor, onTasteChanged, type TasteChange } from "./taste-change"

beforeEach(() => {
  invalidateExploreCache.mockReset()
  invalidateExploreCache.mockResolvedValue(undefined)
})

describe("invalidationFor (policy table)", () => {
  const cases: Array<[string, TasteChange, ReturnType<typeof invalidationFor>]> = [
    ["thumb from a rail", { kind: "feedback", railKey: "outside" }, { explore: ["outside"], feed: false }],
    ["thumb without rail / un-thumb", { kind: "feedback" }, { explore: "all", feed: false }],
    ["save / unsave", { kind: "save" }, { explore: "all", feed: false }],
    ["undismiss", { kind: "undismiss" }, { explore: "all", feed: false }],
    ["seed add / remove", { kind: "seeds" }, { explore: "all", feed: false }],
    ["settings: selectedGenres", { kind: "settings", fields: ["selectedGenres"] }, { explore: "all", feed: true }],
    ["settings: adventurous", { kind: "settings", fields: ["adventurous"] }, { explore: "all", feed: true }],
    ["settings: undergroundMode", { kind: "settings", fields: ["undergroundMode"] }, { explore: "all", feed: true }],
    ["settings: deepDiscovery", { kind: "settings", fields: ["deepDiscovery"] }, { explore: "all", feed: true }],
    ["settings: popularityCurve", { kind: "settings", fields: ["popularityCurve"] }, { explore: "all", feed: false }],
    ["settings: curve + genres", { kind: "settings", fields: ["popularityCurve", "selectedGenres"] }, { explore: "all", feed: true }],
    ["settings: playThreshold", { kind: "settings", fields: ["playThreshold"] }, { explore: null, feed: false }],
    ["settings: usernames/platform", { kind: "settings", fields: ["lastfmUsername", "preferredMusicPlatform"] }, { explore: null, feed: false }],
  ]
  it.each(cases)("%s", (_label, change, expected) => {
    expect(invalidationFor(change)).toEqual(expected)
  })
})

describe("onTasteChanged", () => {
  const rows = () => ({
    recommendation_cache: [
      { user_id: "u1", artist_id: "a", seen_at: null },
      { user_id: "u1", artist_id: "b", seen_at: "2026-10-01T00:00:00Z" },
      { user_id: "u2", artist_id: "c", seen_at: null },
    ],
  })

  it("narrow rail invalidation passes the rail list", async () => {
    const { client } = createFakeSupabase(rows())
    await onTasteChanged(client, "u1", { kind: "feedback", railKey: "wildcards" })
    expect(invalidateExploreCache).toHaveBeenCalledWith("u1", ["wildcards"])
  })

  it("'all' passes no rail list and leaves the feed alone", async () => {
    const { client, tables } = createFakeSupabase(rows())
    await onTasteChanged(client, "u1", { kind: "save" })
    expect(invalidateExploreCache).toHaveBeenCalledWith("u1", undefined)
    expect(tables.recommendation_cache).toHaveLength(3)
  })

  it("feed-affecting settings wipe only the user's unseen rows", async () => {
    const { client, tables } = createFakeSupabase(rows())
    await onTasteChanged(client, "u1", { kind: "settings", fields: ["adventurous"] })
    expect(tables.recommendation_cache.map((r) => r.artist_id)).toEqual(["b", "c"])
  })

  it("no-op settings touch nothing", async () => {
    const { client, tables } = createFakeSupabase(rows())
    await onTasteChanged(client, "u1", { kind: "settings", fields: ["playThreshold"] })
    expect(invalidateExploreCache).not.toHaveBeenCalled()
    expect(tables.recommendation_cache).toHaveLength(3)
  })

  it("never throws when invalidation fails", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {})
    invalidateExploreCache.mockRejectedValue(new Error("boom"))
    const { client } = createFakeSupabase(rows())
    await expect(onTasteChanged(client, "u1", { kind: "seeds" })).resolves.toBeUndefined()
    spy.mockRestore()
  })
})
