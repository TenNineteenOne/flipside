/** #175 S8: non-string usernames get the route's 400, not a 500 from `.trim()`. */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { createRouteFakeDb } from "@/lib/api/__fixtures__/route-fake-db"

let db: ReturnType<typeof createRouteFakeDb>
vi.mock("@/lib/supabase/server", () => ({ createServiceClient: () => db.client }))
vi.mock("@/lib/auth", () => ({ safeAuth: vi.fn(async () => ({ user: { id: "u1" } })) }))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))
vi.mock("@/lib/taste-change", () => ({ onTasteChanged: vi.fn(async () => {}) }))

import { PATCH } from "./route"

const call = (body: unknown) =>
  PATCH(new Request("https://flipside.test/api/settings", {
    method: "PATCH",
    headers: { origin: "https://flipside.test", host: "flipside.test" },
    body: JSON.stringify(body),
  }))

beforeEach(() => {
  db = createRouteFakeDb({ users: [{ id: "u1" }] })
})

describe("PATCH /api/settings type guards", () => {
  it.each([5, null, ["x"], { a: 1 }])("lastfmUsername %j → 400", async (v) => {
    const res = await call({ lastfmUsername: v })
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: "Invalid Last.fm username format" })
  })

  it.each([5, null, true])("statsfmUsername %j → 400", async (v) => {
    const res = await call({ statsfmUsername: v })
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: "Invalid stats.fm username format" })
  })

  it("JSON null body → 400", async () => {
    expect((await call(null)).status).toBe(400)
  })
})

describe("PATCH /api/settings fame level + Wander farther (#205)", () => {
  it.each([0, 4])("fameLevel %i → 200, saved as fame_level", async (v) => {
    const res = await call({ fameLevel: v })
    expect(res.status).toBe(200)
    expect(db.tables.users[0].fame_level).toBe(v)
  })

  it.each([-1, 5, 2.5, "2", null, true])("fameLevel %j → 400", async (v) => {
    const res = await call({ fameLevel: v })
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: "fameLevel must be an integer between 0 and 4" })
  })

  it("adventurous saves a boolean; non-booleans → 400", async () => {
    expect((await call({ adventurous: true })).status).toBe(200)
    expect(db.tables.users[0].adventurous).toBe(true)
    expect((await call({ adventurous: "yes" })).status).toBe(400)
  })

  it.each(["playThreshold", "popularityCurve", "undergroundMode", "deepDiscovery"])(
    "retired key %s rejects the whole patch → 400",
    async (key) => {
      const res = await call({ adventurous: true, [key]: 1 })
      expect(res.status).toBe(400)
      expect(await res.json()).toEqual({ error: `${key} is no longer a setting` })
      expect(db.tables.users[0].adventurous).toBeUndefined()
    },
  )
})

describe("PATCH /api/settings source username switch", () => {
  const KEY = Buffer.alloc(32, 7).toString("base64")
  beforeEach(async () => {
    vi.stubEnv("USERNAME_ENCRYPTION_KEY", KEY)
    const { resetKeyCacheForTests } = await import("@/lib/crypto/username")
    resetKeyCacheForTests()
  })

  it("a changed Last.fm username clears the Last.fm sync cooldown only", async () => {
    const { encryptUsername } = await import("@/lib/crypto/username")
    db = createRouteFakeDb({ users: [{
      id: "u1",
      lastfm_username: encryptUsername("alice"),
      last_accumulated_lastfm_at: "2026-11-12T00:00:00.000Z",
      last_accumulated_statsfm_at: "2026-11-12T00:00:00.000Z",
    }] })
    expect((await call({ lastfmUsername: "bob" })).status).toBe(200)
    expect(db.tables.users[0].last_accumulated_lastfm_at).toBeNull()
    expect(db.tables.users[0].last_accumulated_statsfm_at).toBe("2026-11-12T00:00:00.000Z")
  })

  it("re-saving the same username keeps the cooldown", async () => {
    const { encryptUsername } = await import("@/lib/crypto/username")
    db = createRouteFakeDb({ users: [{
      id: "u1",
      statsfm_username: encryptUsername("alice"),
      last_accumulated_statsfm_at: "2026-11-12T00:00:00.000Z",
    }] })
    expect((await call({ statsfmUsername: " alice " })).status).toBe(200)
    expect(db.tables.users[0].last_accumulated_statsfm_at).toBe("2026-11-12T00:00:00.000Z")
  })
})

describe("PATCH /api/settings deleted account", () => {
  it("401s instead of reporting success when the users row is gone", async () => {
    db = createRouteFakeDb({ users: [] })
    expect((await call({ adventurous: true })).status).toBe(401)
  })
})
