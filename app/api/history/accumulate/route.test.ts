/** #175 F22: atomic per-source accumulate cooldown. */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { createRouteFakeDb } from "@/lib/api/__fixtures__/route-fake-db"

let db: ReturnType<typeof createRouteFakeDb>
vi.mock("@/lib/supabase/server", () => ({ createServiceClient: () => db.client }))
vi.mock("@/lib/auth", () => ({ safeAuth: vi.fn(async () => ({ user: { id: "u1" } })) }))
vi.mock("@/lib/crypto/username", () => ({ decryptUsername: (s: string) => s }))
const accumulateLastFmHistory = vi.fn()
vi.mock("@/lib/history/lastfm-syncer", () => ({ accumulateLastFmHistory: (...a: unknown[]) => accumulateLastFmHistory(...a) }))
vi.mock("@/lib/history/statsfm-syncer", () => ({ accumulateStatsFmHistory: vi.fn() }))

import { POST } from "./route"

const OLD = "2026-01-01T00:00:00.000Z"
const call = () =>
  POST(new Request("https://flipside.test/api/history/accumulate", {
    method: "POST",
    headers: { origin: "https://flipside.test", host: "flipside.test" },
    body: JSON.stringify({ source: "lastfm" }),
  }))

beforeEach(() => {
  db = createRouteFakeDb({
    users: [{ id: "u1", lastfm_username: "nick", statsfm_username: null, last_accumulated_lastfm_at: OLD, last_accumulated_statsfm_at: null }],
  })
  accumulateLastFmHistory.mockReset()
  vi.spyOn(console, "error").mockImplementation(() => {})
})

describe("POST /api/history/accumulate cooldown", () => {
  it("two concurrent requests run ONE sync; the other gets the 429", async () => {
    let release!: () => void
    accumulateLastFmHistory.mockReturnValue(new Promise<void>((r) => { release = r }))
    const a = call()
    const b = call()
    const second = await b
    release()
    const first = await a
    expect([first.status, second.status].sort()).toEqual([200, 429])
    expect(accumulateLastFmHistory).toHaveBeenCalledOnce()
  })

  it("a failed sync restores the previous stamp (cooldown not consumed)", async () => {
    accumulateLastFmHistory.mockRejectedValue(new Error("boom"))
    const res = await call()
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: "Last.fm sync failed" })
    expect(db.tables.users[0].last_accumulated_lastfm_at).toBe(OLD)
  })
})
