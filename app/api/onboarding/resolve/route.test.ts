/** #175 F9: a MusicBrainz-path mint uses MB's canonical name, never client text. */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { createRouteFakeDb } from "@/lib/api/__fixtures__/route-fake-db"

let db: ReturnType<typeof createRouteFakeDb>
vi.mock("@/lib/supabase/server", () => ({ createServiceClient: () => db.client }))
vi.mock("@/lib/auth", () => ({ safeAuth: vi.fn(async () => ({ user: { id: "u1" } })) }))

import { POST } from "./route"

const MBID = "a74b1b7f-71a5-4011-9441-d0b5e4122711"
const SPOTIFY = "4Z8W4fKeB5YxbusRsdQVPb"
const mbResponse = (name: string) =>
  new Response(JSON.stringify({
    name,
    relations: [{ url: { resource: `https://open.spotify.com/artist/${SPOTIFY}` } }],
  }))

const call = (name: string) =>
  POST(new Request("https://flipside.test/api/onboarding/resolve", {
    method: "POST",
    headers: { origin: "https://flipside.test", host: "flipside.test" },
    body: JSON.stringify({ name, mbid: MBID }),
  }))

beforeEach(() => {
  db = createRouteFakeDb({ artists: [] })
  vi.spyOn(console, "log").mockImplementation(() => {})
})
afterEach(() => vi.unstubAllGlobals())

describe("POST /api/onboarding/resolve mint name", () => {
  it("mints with MB's canonical name when the client name matches it", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => mbResponse("Radiohead")))
    const res = await call("radiohead")
    expect(res.status).toBe(200)
    expect(db.tables.artists).toHaveLength(1)
    expect(db.tables.artists[0]).toMatchObject({ spotify_id: SPOTIFY, name: "Radiohead", name_lower: "radiohead" })
    expect((await res.json()).name).toBe("radiohead") // response body unchanged
  })

  it("404s and mints nothing when the client name doesn't match MB's", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => mbResponse("Radiohead")))
    const res = await call("Totally Different Text")
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: "Could not resolve this artist" })
    expect(db.tables.artists).toHaveLength(0)
  })

  it.each([
    ["Bjork", "Björk"],
    ["Sigur Ros", "Sigur Rós"],
    ["BTS", "방탄소년단"],
  ])("#175 R6: %s resolves against MB %s and mints MB's name", async (client, mb) => {
    vi.stubGlobal("fetch", vi.fn(async () => mbResponse(mb)))
    const res = await call(client)
    expect(res.status).toBe(200)
    expect(db.tables.artists).toHaveLength(1)
    expect(db.tables.artists[0].name).toBe(mb)
  })

  it("#175 R6: an obvious Latin mismatch still 404s", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => mbResponse("Metallica")))
    const res = await call("Taylor Swift")
    expect(res.status).toBe(404)
    expect(db.tables.artists).toHaveLength(0)
  })
})
