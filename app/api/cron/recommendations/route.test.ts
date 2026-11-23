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

// The fake has no functions: the prune RPC (migration 0045) is stubbed per test.
const rpc = vi.fn()
function fakeDb(...args: Parameters<typeof createRouteFakeDb>) {
  const fake = createRouteFakeDb(...args)
  fake.client.rpc = rpc
  return fake
}

beforeEach(() => {
  rpc.mockReset().mockResolvedValue({ data: 0, error: null })
  process.env.CRON_SECRET = "s3cret"
  vi.spyOn(console, "log").mockImplementation(() => {})
})

describe("GET /api/cron/recommendations (#175 F6b)", () => {
  it("does not re-stamp already-expired rows, so they age into the 30-day delete", async () => {
    const now = Date.now()
    db = fakeDb({
      recommendation_cache: [
        // stale + live → expired now
        { id: "live", seen_at: null, skip_at: null, created_at: iso(now - 5 * DAY), expires_at: iso(now + DAY) },
        // expired 10 days ago → left alone (old code reset it to now every run)
        { id: "old", seen_at: null, skip_at: null, created_at: iso(now - 20 * DAY), expires_at: iso(now - 10 * DAY) },
      ],
    })
    const res = await call()
    expect(await res.json()).toEqual({ success: true, expired: 1, deleted: 0 })
    const byId = Object.fromEntries(db.tables.recommendation_cache.map((r) => [r.id, r.expires_at]))
    expect(Object.keys(byId).sort()).toEqual(["live", "old"])
    expect(byId.old).toBe(iso(now - 10 * DAY))
    expect(Date.parse(byId.live)).toBeLessThanOrEqual(Date.now())
  })

  it("deletes login_attempts rows older than 24 hours and keeps recent ones", async () => {
    const now = Date.now()
    db = fakeDb({
      login_attempts: [
        { ip_hash: "stale", attempt_count: 3, window_start: iso(now - 2 * DAY) },
        { ip_hash: "fresh", attempt_count: 1, window_start: iso(now - 60_000) },
      ],
    })
    expect((await call()).status).toBe(200)
    expect(db.tables.login_attempts.map((r) => r.ip_hash)).toEqual(["fresh"])
  })

  it("a failed login_attempts delete is logged and does not fail the job", async () => {
    db = fakeDb({}, { login_attempts: "delete" })
    const err = vi.spyOn(console, "error").mockImplementation(() => {})
    expect((await call()).status).toBe(200)
    expect(err).toHaveBeenCalledWith("[cron/recommendations] login_attempts delete error:", "fake login_attempts delete failed")
  })

  it("prunes through rpc_prune_recommendation_cache with a 30-day cutoff and reports its count (#219)", async () => {
    db = fakeDb({})
    rpc.mockResolvedValue({ data: 7, error: null })
    const before = Date.now()
    expect(await (await call()).json()).toEqual({ success: true, expired: 0, deleted: 7 })
    expect(rpc).toHaveBeenCalledOnce()
    const [name, args] = rpc.mock.calls[0]
    expect(name).toBe("rpc_prune_recommendation_cache")
    // 30 calendar days back; an hour of slack for a DST change in the local zone.
    expect(Math.abs(before - 30 * DAY - Date.parse(args.p_cutoff))).toBeLessThan(2 * 3_600_000)
  })

  it("deletes nothing from recommendation_cache when the prune RPC is missing or fails (#219)", async () => {
    const now = Date.now()
    db = fakeDb({
      recommendation_cache: [
        { id: "liked", seen_at: iso(now - 70 * DAY), skip_at: null, created_at: iso(now - 70 * DAY), expires_at: iso(now - 40 * DAY) },
      ],
    })
    rpc.mockResolvedValue({ data: null, error: { code: "PGRST202", message: "Could not find the function" } })
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    const res = await call()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ success: true, expired: 0, deleted: 0 })
    expect(db.tables.recommendation_cache.map((r) => r.id)).toEqual(["liked"])
    expect(db.log.some((l) => l.table === "recommendation_cache" && l.op === "delete")).toBe(false)
    expect(warn).toHaveBeenCalledWith(
      "[cron/recommendations] prune skipped (is migration 0045 applied?):",
      "Could not find the function",
    )
  })
})
