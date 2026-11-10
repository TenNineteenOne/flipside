/** #175 F21: saves store an artist name for Explore artists too. */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { createRouteFakeDb } from "@/lib/api/__fixtures__/route-fake-db"

let db: ReturnType<typeof createRouteFakeDb>
vi.mock("@/lib/supabase/server", () => ({ createServiceClient: () => db.client }))
vi.mock("@/lib/auth", () => ({ safeAuth: vi.fn(async () => ({ user: { id: "u1" } })) }))
vi.mock("@/lib/taste-change", () => ({ onTasteChanged: vi.fn(async () => {}) }))

import { POST } from "./route"

const ID = "11111111-1111-4111-8111-111111111111"
const save = () =>
  POST(new Request("https://flipside.test/api/saves", {
    method: "POST",
    headers: { origin: "https://flipside.test", host: "flipside.test" },
    body: JSON.stringify({ artistId: ID }),
  }))

beforeEach(() => {
  db = createRouteFakeDb({ artists: [{ id: ID, name: "Radiohead" }] })
})

describe("POST /api/saves artist_name", () => {
  it("prefers the user's recommendation_cache name", async () => {
    db.tables.recommendation_cache = [{ user_id: "u1", artist_id: ID, artist_data: { name: "Feed Name" } }]
    expect((await save()).status).toBe(200)
    expect(db.tables.saves[0].artist_name).toBe("Feed Name")
  })

  it("falls back to the artists row name (Explore artist, not in recommendation_cache)", async () => {
    expect(await (await save()).json()).toEqual({ success: true, saved: true, playlistId: null })
    expect(db.tables.saves[0].artist_name).toBe("Radiohead")
  })
})
