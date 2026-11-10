import { describe, it, expect, vi, beforeEach } from "vitest"
import { createFakeSupabase } from "@/lib/recommendation/__fixtures__/fake-supabase"

const getSpotifyClientToken = vi.fn<() => Promise<string | null>>()
vi.mock("@/lib/spotify-client-token", () => ({ getSpotifyClientToken: () => getSpotifyClientToken() }))

import { exploreInputFromRow, loadExploreInput } from "./explore-input"

beforeEach(() => {
  getSpotifyClientToken.mockReset()
  getSpotifyClientToken.mockResolvedValue("client-tok")
})

describe("exploreInputFromRow", () => {
  it("maps NULL flags to false and NULL curve/threshold to undefined", () => {
    expect(
      exploreInputFromRow(
        { id: "u1", adventurous: null, underground_mode: null, popularity_curve: null, play_threshold: null },
        "",
      ),
    ).toEqual({
      userId: "u1",
      accessToken: "",
      adventurous: false,
      undergroundMode: false,
      popularityCurve: undefined,
      playThreshold: undefined,
    })
  })

  it("passes through booleans and numbers (including 0)", () => {
    expect(
      exploreInputFromRow(
        { id: "u1", adventurous: true, underground_mode: true, popularity_curve: 0.92, play_threshold: 0 },
        "tok",
      ),
    ).toEqual({
      userId: "u1",
      accessToken: "tok",
      adventurous: true,
      undergroundMode: true,
      popularityCurve: 0.92,
      playThreshold: 0,
    })
  })

  it("treats non-numeric curve/threshold as undefined", () => {
    const input = exploreInputFromRow({ id: "u1", popularity_curve: "0.9", play_threshold: "5" }, "")
    expect(input.popularityCurve).toBeUndefined()
    expect(input.playThreshold).toBeUndefined()
  })
})

describe("loadExploreInput", () => {
  it("returns the mapped input with the client token", async () => {
    const { client } = createFakeSupabase({
      users: [{ id: "u1", adventurous: true, underground_mode: null, popularity_curve: 0.95, play_threshold: 3 }],
    })
    expect(await loadExploreInput(client, "u1")).toEqual({
      userId: "u1",
      accessToken: "client-tok",
      adventurous: true,
      undergroundMode: false,
      popularityCurve: 0.95,
      playThreshold: 3,
    })
  })

  it("falls back to '' when the client token is unavailable", async () => {
    getSpotifyClientToken.mockResolvedValue(null)
    const { client } = createFakeSupabase({ users: [{ id: "u1" }] })
    expect((await loadExploreInput(client, "u1"))?.accessToken).toBe("")
  })

  it("returns null when the row is missing", async () => {
    const { client } = createFakeSupabase({ users: [] })
    expect(await loadExploreInput(client, "u1")).toBeNull()
  })

  it("returns null when the read errors", async () => {
    const q = {
      select: () => q,
      eq: () => q,
      maybeSingle: () => Promise.resolve({ data: { id: "u1" }, error: { message: "boom" } }),
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const client: any = { from: () => q }
    expect(await loadExploreInput(client, "u1")).toBeNull()
  })
})
