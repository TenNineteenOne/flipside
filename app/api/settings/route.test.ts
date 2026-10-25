/** #175 S8: non-string usernames get the route's 400, not a 500 from `.trim()`. */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { createRouteFakeDb } from "@/lib/api/__fixtures__/route-fake-db"

let db: ReturnType<typeof createRouteFakeDb>
vi.mock("@/lib/supabase/server", () => ({ createServiceClient: () => db.client }))
vi.mock("@/lib/auth", () => ({ safeAuth: vi.fn(async () => ({ user: { id: "u1" } })) }))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))
vi.mock("@/lib/taste-change", () => ({ onTasteChanged: vi.fn(async () => {}) }))

import { PATCH } from "./route"

const call = (body: unknown) =>
  PATCH(new Request("https://flipside.test/api/settings", {
    method: "PATCH",
    headers: { origin: "https://flipside.test", host: "flipside.test" },
    body: JSON.stringify(body),
  }))

beforeEach(() => {
  db = createRouteFakeDb({ users: [{ id: "u1" }] })
})

describe("PATCH /api/settings type guards", () => {
  it.each([5, null, ["x"], { a: 1 }])("lastfmUsername %j → 400", async (v) => {
    const res = await call({ lastfmUsername: v })
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: "Invalid Last.fm username format" })
  })

  it.each([5, null, true])("statsfmUsername %j → 400", async (v) => {
    const res = await call({ statsfmUsername: v })
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: "Invalid stats.fm username format" })
  })

  it("JSON null body → 400", async () => {
    expect((await call(null)).status).toBe(400)
  })
})
