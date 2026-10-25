/** #175 F28: user input can't become a multi-char PostgREST wildcard. */
import { describe, it, expect, vi } from "vitest"
import { NextRequest } from "next/server"

const patterns: string[] = []
const chain = {
  select: () => chain,
  ilike: (_col: string, p: string) => { patterns.push(p); return chain },
  limit: async () => ({ data: [], error: null }),
}
vi.mock("@/lib/supabase/server", () => ({ createServiceClient: () => ({ from: () => chain }) }))
vi.mock("@/lib/auth", () => ({ safeAuth: vi.fn(async () => ({ user: { id: "u1" } })) }))
vi.mock("@/lib/lastfm", () => ({ lastfm: { searchArtists: vi.fn(async () => []) } }))

import { GET } from "./route"

describe("GET /api/onboarding/search ILIKE escaping", () => {
  it("escapes % _ \\ and maps * (PostgREST's %) to a single-char _", async () => {
    await GET(new NextRequest(`https://flipside.test/api/onboarding/search?q=${encodeURIComponent("*a%b_c\\d*")}`))
    expect(patterns).toEqual(["_a\\%b\\_c\\\\d_%"])
    expect(patterns[0].replace(/%$/, "")).not.toMatch(/\*/)
  })
})
