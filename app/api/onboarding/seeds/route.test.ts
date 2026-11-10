/** #175 S6/S8: onboarding seeds enforce the 200 total cap and 400 a `null` body. */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { randomUUID } from "node:crypto"
import { createRouteFakeDb } from "@/lib/api/__fixtures__/route-fake-db"

let db: ReturnType<typeof createRouteFakeDb>
vi.mock("@/lib/supabase/server", () => ({ createServiceClient: () => db.client }))
vi.mock("@/lib/auth", () => ({ safeAuth: vi.fn(async () => ({ user: { id: "u1" } })) }))

import { POST } from "./route"

const artist = (id = randomUUID()) => ({ id, name: `A ${id.slice(0, 4)}`, imageUrl: null })
const call = (body: unknown) =>
  POST(new Request("https://flipside.test/api/onboarding/seeds", {
    method: "POST",
    headers: { origin: "https://flipside.test", host: "flipside.test" },
    body: JSON.stringify(body),
  }))
const seeds = (n: number, userId = "u1") =>
  Array.from({ length: n }, () => ({ user_id: userId, artist_id: randomUUID() }))

beforeEach(() => {
  db = createRouteFakeDb({ seed_artists: [] })
})

describe("POST /api/onboarding/seeds", () => {
  it("400s a JSON null body instead of throwing", async () => {
    const res = await call(null)
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: "artists must be an array of 3–200 entries" })
  })

  it("rejects adds that push the user's total past 200", async () => {
    db = createRouteFakeDb({ seed_artists: [...seeds(198), ...seeds(5, "u2")] })
    const res = await call({ artists: [artist(), artist(), artist()] })
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: "Cannot exceed 200 seed artists" })
    expect(db.tables.seed_artists).toHaveLength(203)
  })

  it("re-sent existing seeds don't count against the cap", async () => {
    const existing = seeds(199)
    db = createRouteFakeDb({ seed_artists: existing })
    const res = await call({ artists: [artist(existing[0].artist_id), artist(existing[1].artist_id), artist()] })
    expect(res.status).toBe(200)
  })
})
