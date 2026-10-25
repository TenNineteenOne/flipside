/**
 * Route-level test through the shared shell: the handler gets its Supabase
 * client from withAuthedRoute's context, so mocking `@/lib/supabase/server`
 * with the in-memory fake is all it takes to exercise the real route.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { createFakeSupabase, type FakeSupabase } from "@/lib/recommendation/__fixtures__/fake-supabase"

let fake: FakeSupabase
vi.mock("@/lib/supabase/server", () => ({ createServiceClient: () => fake.client }))
vi.mock("@/lib/auth", () => ({ safeAuth: vi.fn() }))
const itunesFetch = vi.fn()
vi.mock("@/lib/music-provider/itunes", () => ({ itunesFetch: (...a: unknown[]) => itunesFetch(...a) }))

import { safeAuth } from "@/lib/auth"
import { GET } from "./route"

const ID = "11111111-1111-4111-8111-111111111111"
const call = (platform: string, id: string, query = "?name=Radiohead") =>
  GET(new Request(`https://flipside.test/api/open/${platform}/${id}${query}`), {
    params: Promise.resolve({ platform, artistId: id }),
  })

beforeEach(() => {
  fake = createFakeSupabase({ artists: [{ id: ID, name: "Radiohead", apple_id: "657515" }] })
  vi.mocked(safeAuth).mockResolvedValue({ user: { id: "u1" } } as Awaited<ReturnType<typeof safeAuth>>)
  itunesFetch.mockReset()
})

describe("GET /api/open/[platform]/[artistId]", () => {
  it("401s without a session (shell response)", async () => {
    vi.mocked(safeAuth).mockResolvedValue(null)
    const res = await call("apple_music", ID)
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: "Unauthorized" })
  })

  it("400s on an unsupported platform or bad id", async () => {
    expect((await call("spotify", ID)).status).toBe(400)
    expect((await call("apple_music", "nope")).status).toBe(400)
  })

  it("redirects to apple.com root when name is missing", async () => {
    const res = await call("apple_music", ID, "")
    expect(res.status).toBe(302)
    expect(res.headers.get("location")).toBe("https://music.apple.com/")
  })

  it("302s to the iTunes page resolved from the artists row name, not ?name (apple_id ignored)", async () => {
    itunesFetch.mockResolvedValue({
      ok: true,
      data: { results: [{ artistId: 1, artistName: "Radiohead", artistLinkUrl: "https://music.apple.com/us/artist/radiohead/1" }] },
    })
    const res = await call("apple_music", ID, "?name=Evil")
    expect(res.status).toBe(302)
    expect(res.headers.get("location")).toBe("https://music.apple.com/us/artist/radiohead/1")
    expect(itunesFetch.mock.calls[0][0]).toContain("term=Radiohead&")
  })

  it("rate-limits per user at 30/min with the shared 429 shape", async () => {
    vi.mocked(safeAuth).mockResolvedValue({ user: { id: "u-limit" } } as Awaited<ReturnType<typeof safeAuth>>)
    for (let i = 0; i < 30; i++) expect((await call("apple_music", ID, "")).status).toBe(302)
    const res = await call("apple_music", ID, "")
    expect(res.status).toBe(429)
    expect(await res.json()).toEqual({ error: "Too many requests — slow down for a moment" })
    vi.mocked(safeAuth).mockResolvedValue({ user: { id: "u-other" } } as Awaited<ReturnType<typeof safeAuth>>)
    expect((await call("apple_music", ID, "")).status).toBe(302)
  })

  it("404s an unknown artist id without calling iTunes", async () => {
    const res = await call("apple_music", "22222222-2222-4222-8222-222222222222")
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: "Not found" })
    expect(itunesFetch).not.toHaveBeenCalled()
  })
})
