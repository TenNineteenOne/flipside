import { describe, it, expect, vi, beforeEach } from "vitest"
import { createRouteFakeDb } from "@/lib/api/__fixtures__/route-fake-db"

let db: ReturnType<typeof createRouteFakeDb>
const signOut = vi.fn(async (_opts: unknown) => ({}))
vi.mock("@/lib/supabase/server", () => ({ createServiceClient: () => db.client }))
vi.mock("@/lib/auth", () => ({
  safeAuth: vi.fn(async () => ({ user: { id: "u1" } })),
  signOut: (opts: unknown) => signOut(opts),
}))

import { DELETE } from "./route"

const call = () =>
  DELETE(new Request("https://flipside.test/api/account", {
    method: "DELETE",
    headers: { origin: "https://flipside.test", host: "flipside.test" },
  }))

beforeEach(() => {
  signOut.mockClear()
  vi.spyOn(console, "log").mockImplementation(() => {})
  vi.spyOn(console, "error").mockImplementation(() => {})
})

describe("DELETE /api/account", () => {
  it("deletes the user, clears the session without redirecting, and answers 200 JSON", async () => {
    db = createRouteFakeDb({ users: [{ id: "u1" }, { id: "u2" }] })
    const res = await call()
    expect(res.status).toBe(200) // not a 3xx: fetch would follow it as DELETE / (405)
    expect(await res.json()).toEqual({ success: true })
    expect(db.tables.users).toEqual([{ id: "u2" }])
    // signOut is what writes the cleared session cookie (next-auth sets it through cookies()).
    expect(signOut).toHaveBeenCalledWith({ redirect: false })
  })

  it("a failed delete answers 500 and leaves the session alone", async () => {
    db = createRouteFakeDb({ users: [{ id: "u1" }] }, { users: "delete" })
    const res = await call()
    expect(res.status).toBe(500)
    expect(signOut).not.toHaveBeenCalled()
  })
})
