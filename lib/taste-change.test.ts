import { describe, it, expect, vi } from "vitest"
import { createFakeSupabase } from "@/lib/recommendation/__fixtures__/fake-supabase"
import { invalidationFor, onTasteChanged, type TasteChange } from "./taste-change"

describe("invalidationFor (policy table)", () => {
  const cases: Array<[string, TasteChange, ReturnType<typeof invalidationFor>]> = [
    ["thumb / un-thumb", { kind: "feedback" }, { feed: false }],
    ["save / unsave", { kind: "save" }, { feed: false }],
    ["undismiss", { kind: "undismiss" }, { feed: false }],
    ["seed add / remove", { kind: "seeds" }, { feed: false }],
    ["settings: selectedGenres", { kind: "settings", fields: ["selectedGenres"] }, { feed: true }],
    ["settings: fameLevel (next batch only, #205)", { kind: "settings", fields: ["fameLevel"] }, { feed: false }],
    ["settings: adventurous (next batch only, #205)", { kind: "settings", fields: ["adventurous"] }, { feed: false }],
    ["settings: usernames/platform", { kind: "settings", fields: ["lastfmUsername", "preferredMusicPlatform"] }, { feed: false }],
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

  it("feed-affecting settings wipe only the user's unseen rows", async () => {
    const { client, tables } = createFakeSupabase(rows())
    await onTasteChanged(client, "u1", { kind: "settings", fields: ["selectedGenres"] })
    expect(tables.recommendation_cache.map((r) => r.artist_id)).toEqual(["b", "c"])
  })

  it("never touches the users row (#175 S1)", async () => {
    const { client, queries } = createFakeSupabase({ ...rows(), users: [{ id: "u1" }] })
    await onTasteChanged(client, "u1", { kind: "settings", fields: ["selectedGenres"] })
    expect(queries.filter((q) => q.table === "users")).toHaveLength(0)
  })

  it("fame, adventurous and non-settings changes leave the Feed queue alone (#205)", async () => {
    const { client, tables } = createFakeSupabase(rows())
    await onTasteChanged(client, "u1", { kind: "settings", fields: ["fameLevel"] })
    await onTasteChanged(client, "u1", { kind: "settings", fields: ["adventurous"] })
    await onTasteChanged(client, "u1", { kind: "save" })
    expect(tables.recommendation_cache).toHaveLength(3)
  })

  it("never throws when the wipe fails", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {})
    const { client } = createFakeSupabase(rows())
    const failing = { ...client, from: () => ({ delete: () => ({ eq: () => ({ is: async () => ({ error: { message: "boom" } }) }) }) }) } as unknown as typeof client
    await expect(onTasteChanged(failing, "u1", { kind: "settings", fields: ["selectedGenres"] })).resolves.toBeUndefined()
    expect(spy).toHaveBeenCalled()
    spy.mockRestore()
  })
})
