/** #175 F7: the non-force cold-cache build claims the explore cooldown. */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"
import { createRouteFakeDb } from "@/lib/api/__fixtures__/route-fake-db"

let db: ReturnType<typeof createRouteFakeDb>
vi.mock("@/lib/supabase/server", () => ({ createServiceClient: () => db.client }))
vi.mock("@/lib/auth", () => ({ safeAuth: vi.fn(async () => ({ user: { id: "u1" } })) }))
vi.mock("@/lib/explore-input", () => ({ loadExploreInput: vi.fn(async () => ({ userId: "u1" })) }))
const buildExploreRails = vi.fn()
vi.mock("@/lib/recommendation/explore-engine", () => ({
  RAIL_KEYS: ["adjacent", "outside", "wildcards", "leftfield"],
  buildExploreRails: (...a: unknown[]) => buildExploreRails(...a),
}))

import { POST } from "./route"

const iso = (ms: number) => new Date(ms).toISOString()
const call = () =>
  POST(new NextRequest("https://flipside.test/api/explore/generate", {
    method: "POST",
    headers: { origin: "https://flipside.test", host: "flipside.test" },
  }))

beforeEach(() => {
  buildExploreRails.mockReset()
  buildExploreRails.mockResolvedValue({ cacheHit: false, rails: [] })
})

describe("POST /api/explore/generate (non-force)", () => {
  it("cold cache + cooling → no build, 'building, poll' response", async () => {
    db = createRouteFakeDb({ users: [{ id: "u1", last_explore_generated_at: iso(Date.now() - 1000) }] })
    const res = await call()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ success: true, regenerating: true })
    expect(buildExploreRails).not.toHaveBeenCalled()
  })

  it("cold cache → claims the cooldown, then builds synchronously", async () => {
    db = createRouteFakeDb({ users: [{ id: "u1", last_explore_generated_at: null }] })
    const res = await call()
    expect(await res.json()).toEqual({ success: true, cacheHit: false, rails: [] })
    expect(buildExploreRails).toHaveBeenCalledOnce()
    expect(db.tables.users[0].last_explore_generated_at).not.toBeNull()
  })

  it("warm cache → builds (cache read) without touching the cooldown", async () => {
    const future = iso(Date.now() + 3_600_000)
    db = createRouteFakeDb({
      users: [{ id: "u1", last_explore_generated_at: iso(Date.now() - 1000) }],
      explore_cache: ["adjacent", "outside", "wildcards", "leftfield"].map((k) => ({ user_id: "u1", rail_key: k, expires_at: future })),
    })
    await call()
    expect(buildExploreRails).toHaveBeenCalledOnce()
  })
})
