/**
 * Queue-full gate (#175 F6a/F35): counts only unexpired unseen rows, and runs
 * before the cooldown claim so a queue-full 429 doesn't burn the cooldown.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"
import { createRouteFakeDb, type Row } from "@/lib/api/__fixtures__/route-fake-db"

let db: ReturnType<typeof createRouteFakeDb>
vi.mock("@/lib/supabase/server", () => ({ createServiceClient: () => db.client }))
vi.mock("@/lib/auth", () => ({ safeAuth: vi.fn(async () => ({ user: { id: "u1" } })) }))
vi.mock("@/lib/spotify-client-token", () => ({ getSpotifyClientToken: vi.fn(async () => "") }))
const buildRecommendations = vi.fn()
vi.mock("@/lib/recommendation/engine", () => ({ buildRecommendations: (...a: unknown[]) => buildRecommendations(...a) }))
vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), after: vi.fn() }))

import { POST } from "./route"

const HOUR = 3_600_000
const iso = (ms: number) => new Date(ms).toISOString()
const queue = (n: number, expiresAt: string): Row[] =>
  Array.from({ length: n }, (_, i) => ({ id: `r${i}`, user_id: "u1", artist_id: `a${i}`, seen_at: null, expires_at: expiresAt }))

const call = () =>
  POST(new NextRequest("https://flipside.test/api/recommendations/generate", {
    method: "POST",
    headers: { origin: "https://flipside.test", host: "flipside.test" },
  }))

beforeEach(() => {
  buildRecommendations.mockReset()
  buildRecommendations.mockResolvedValue({
    count: 0, pending: false, finish: async () => {}, softenedFilters: [],
    metrics: { firstBatchMs: 0, primaryMs: 0, previewMs: 0, misses: 0, retries: 0, rateLimited: false },
  })
  vi.spyOn(console, "log").mockImplementation(() => {})
  vi.spyOn(console, "error").mockImplementation(() => {})
})

describe("POST /api/recommendations/generate queue-full gate", () => {
  it("60 expired unseen rows don't count as a full queue (returning user)", async () => {
    db = createRouteFakeDb({
      users: [{ id: "u1", last_generated_at: null }],
      recommendation_cache: queue(60, iso(Date.now() - HOUR)),
    })
    const res = await call()
    expect(res.status).toBe(200)
    expect(buildRecommendations).toHaveBeenCalledOnce()
  })

  it("60 unexpired unseen rows → queue-full 429 without consuming the cooldown", async () => {
    db = createRouteFakeDb({
      users: [{ id: "u1", last_generated_at: null }],
      recommendation_cache: queue(60, iso(Date.now() + HOUR)),
    })
    const res = await call()
    expect(res.status).toBe(429)
    expect(await res.json()).toEqual({
      error: "Your discovery queue is full. Please review some artists before generating more.",
    })
    expect(db.tables.users[0].last_generated_at).toBeNull()
    expect(buildRecommendations).not.toHaveBeenCalled()
  })

  it("cooling → the cooldown 429 body is unchanged", async () => {
    db = createRouteFakeDb({ users: [{ id: "u1", last_generated_at: iso(Date.now() - 1000) }] })
    const res = await call()
    expect(res.status).toBe(429)
    expect(await res.json()).toEqual({ error: "Please wait before generating more recommendations" })
  })
})
