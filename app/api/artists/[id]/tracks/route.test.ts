import { describe, it, expect, vi } from "vitest"
import { NextRequest } from "next/server"

vi.mock("@/lib/supabase/server", () => ({ createServiceClient: () => ({}) }))
vi.mock("@/lib/auth", () => ({ safeAuth: vi.fn(async () => ({ user: { id: "u1" } })) }))
const served = vi.hoisted(() => ({ result: { cacheMiss: false, tracks: [] } as unknown }))
vi.mock("@/lib/recommendation/preview-store", () => ({
  PreviewStore: class {
    async serveTracks() {
      return served.result
    }
  },
}))

import { GET } from "./route"
import { safeAuth } from "@/lib/auth"

const ID = "11111111-1111-4111-8111-111111111111"
const call = () =>
  GET(new NextRequest(`https://flipside.test/api/artists/${ID}/tracks?name=Radiohead`), {
    params: Promise.resolve({ id: ID }),
  })

describe("GET /api/artists/[id]/tracks rate limit (#175 F8)", () => {
  it("allows 120/min per user, then 429s with the shared shape", async () => {
    for (let i = 0; i < 120; i++) expect((await call()).status).toBe(200)
    const res = await call()
    expect(res.status).toBe(429)
    expect(await res.json()).toEqual({ error: "Too many requests — slow down for a moment" })
  })
})

describe("GET /api/artists/[id]/tracks Cache-Control", () => {
  it("browser-caches only a non-empty hit", async () => {
    // fresh user: the rate-limit test above spent u1's window
    vi.mocked(safeAuth).mockResolvedValue({ user: { id: "u2" } } as never)

    served.result = { tracks: [{ id: "t1" }] }
    expect((await call()).headers.get("Cache-Control")).toBe("private, max-age=3600")

    served.result = { tracks: [] }
    expect((await call()).headers.get("Cache-Control")).toBeNull()

    served.result = { tracks: [], cacheMiss: true }
    const miss = await call()
    expect(miss.headers.get("Cache-Control")).toBeNull()
    expect(await miss.json()).toEqual({ tracks: [], cache_miss: true })

    served.result = null
    const err = await call()
    expect(err.status).toBe(500)
    expect(err.headers.get("Cache-Control")).toBeNull()
  })
})
