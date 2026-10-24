/** #175: a thumbs-up before /explore was ever loaded this week still credits the challenge. */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { createRouteFakeDb } from "@/lib/api/__fixtures__/route-fake-db"

let db: ReturnType<typeof createRouteFakeDb>
// Stands in for rpc_record_feedback_v2 → rpc_increment_challenge_progress,
// which no-ops when the user's current-week row doesn't exist.
const rpc = vi.fn(async (_name: string, args: { p_user_id: string; p_signal: string }) => {
  const row = db.tables.user_challenges?.find((r) => r.user_id === args.p_user_id)
  if (row && args.p_signal === "thumbs_up") row.progress = (row.progress ?? 0) + 1
  return { error: null }
})
vi.mock("@/lib/supabase/server", () => ({ createServiceClient: () => ({ from: db.client.from, rpc }) }))
vi.mock("@/lib/auth", () => ({ safeAuth: vi.fn(async () => ({ user: { id: "u1" } })) }))
vi.mock("@/lib/taste-change", () => ({ onTasteChanged: vi.fn(async () => {}) }))

import { POST } from "./route"

const ARTIST = "11111111-1111-4111-8111-111111111111"
const call = (signal: string) =>
  POST(new Request("https://flipside.test/api/feedback", {
    method: "POST",
    headers: { origin: "https://flipside.test", host: "flipside.test" },
    body: JSON.stringify({ artistId: ARTIST, signal }),
  }))

beforeEach(() => {
  rpc.mockClear()
  db = createRouteFakeDb({ users: [{ id: "u1", selected_genres: [] }], user_challenges: [] })
})

describe("POST /api/feedback weekly challenge", () => {
  it("thumbs-up creates the current-week row before the RPC, so progress counts", async () => {
    expect((await call("thumbs_up")).status).toBe(200)
    expect(db.tables.user_challenges).toHaveLength(1)
    expect(db.tables.user_challenges[0].progress).toBe(1)
  })

  it("skip and thumbs-down don't assign a challenge", async () => {
    await call("skip")
    await call("thumbs_down")
    expect(db.tables.user_challenges).toHaveLength(0)
    expect(rpc).toHaveBeenCalledTimes(2)
  })
})
