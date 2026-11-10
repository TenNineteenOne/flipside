import { describe, it, expect, vi, beforeEach } from "vitest"
import { createRouteFakeDb } from "@/lib/api/__fixtures__/route-fake-db"

let db: ReturnType<typeof createRouteFakeDb>
vi.mock("@/lib/supabase/server", () => ({ createServiceClient: () => db.client }))
vi.mock("@/lib/auth", () => ({ safeAuth: vi.fn() }))

import { GET } from "./route"

const DAY = 86_400_000
const iso = (ms: number) => new Date(ms).toISOString()
const call = () =>
  GET(new Request("https://flipside.test/api/cron/recommendations", { headers: { authorization: "Bearer s3cret" } }))

beforeEach(() => {
  process.env.CRON_SECRET = "s3cret"
  vi.spyOn(console, "log").mockImplementation(() => {})
})

describe("GET /api/cron/recommendations (#175 F6b)", () => {
  it("does not re-stamp already-expired rows, so they age into the 30-day delete", async () => {
    const now = Date.now()
    db = createRouteFakeDb({
      recommendation_cache: [
        // stale + live → expired now
        { id: "live", seen_at: null, skip_at: null, created_at: iso(now - 5 * DAY), expires_at: iso(now + DAY) },
        // expired 10 days ago → left alone (old code reset it to now every run)
        { id: "old", seen_at: null, skip_at: null, created_at: iso(now - 20 * DAY), expires_at: iso(now - 10 * DAY) },
        // expired 31 days ago → deleted
        { id: "gone", seen_at: null, skip_at: null, created_at: iso(now - 40 * DAY), expires_at: iso(now - 31 * DAY) },
      ],
    })
    const res = await call()
    expect(await res.json()).toEqual({ success: true, expired: 1, deleted: 1 })
    const byId = Object.fromEntries(db.tables.recommendation_cache.map((r) => [r.id, r.expires_at]))
    expect(Object.keys(byId).sort()).toEqual(["live", "old"])
    expect(byId.old).toBe(iso(now - 10 * DAY))
    expect(Date.parse(byId.live)).toBeLessThanOrEqual(Date.now())
  })
})
