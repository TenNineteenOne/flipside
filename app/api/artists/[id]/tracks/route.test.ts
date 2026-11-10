import { describe, it, expect, vi } from "vitest"
import { NextRequest } from "next/server"

vi.mock("@/lib/supabase/server", () => ({ createServiceClient: () => ({}) }))
vi.mock("@/lib/auth", () => ({ safeAuth: vi.fn(async () => ({ user: { id: "u1" } })) }))
vi.mock("@/lib/recommendation/preview-store", () => ({
  PreviewStore: class {
    async serveTracks() {
      return { cacheMiss: false, tracks: [] }
    }
  },
}))

import { GET } from "./route"

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
