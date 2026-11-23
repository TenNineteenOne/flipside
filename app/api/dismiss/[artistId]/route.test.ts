/** Return to feed must outlive the nightly cron: the row gets a fresh created_at and expires_at. */
import { describe, it, expect, vi } from "vitest"
import { createRouteFakeDb } from "@/lib/api/__fixtures__/route-fake-db"

let db: ReturnType<typeof createRouteFakeDb>
vi.mock("@/lib/supabase/server", () => ({ createServiceClient: () => db.client }))
vi.mock("@/lib/auth", () => ({ safeAuth: vi.fn(async () => ({ user: { id: "u1" } })) }))

import { DELETE } from "./route"

const ARTIST = "11111111-1111-4111-8111-111111111111"
const DAY = 86_400_000
const daysAgo = (n: number) => new Date(Date.now() - n * DAY).toISOString()

function setup(fail: Record<string, string> = {}) {
  db = createRouteFakeDb(
    { recommendation_cache: [{ user_id: "u1", artist_id: ARTIST, created_at: daysAgo(10), expires_at: daysAgo(-20), seen_at: daysAgo(5), skip_at: null }] },
    fail,
  )
  // rpc_clear_dismiss_v2 as the migration defines it: seen_at and skip_at only.
  db.client.rpc = vi.fn(async (_name: string, a: { p_user_id: string; p_artist_id: string }) => {
    for (const r of db.tables.recommendation_cache)
      if (r.user_id === a.p_user_id && r.artist_id === a.p_artist_id) Object.assign(r, { seen_at: null, skip_at: null })
    return { error: null }
  })
}
const call = () =>
  DELETE(
    new Request(`https://flipside.test/api/dismiss/${ARTIST}`, { method: "DELETE", headers: { origin: "https://flipside.test", host: "flipside.test" } }),
    { params: Promise.resolve({ artistId: ARTIST }) },
  )

describe("DELETE /api/dismiss/[artistId]", () => {
  it("a row created 10 days ago and seen 5 days ago survives the cron's expiry and the feed read", async () => {
    setup()
    expect((await call()).status).toBe(204)
    const [row] = db.tables.recommendation_cache
    expect(row.seen_at).toBeNull()
    // cron: unseen rows with created_at older than 3 days are expired
    expect(row.created_at > daysAgo(3)).toBe(true)
    // feed read: expires_at in the future (the engine's 30-day lifetime)
    expect(row.expires_at > daysAgo(-29)).toBe(true)
  })

  it("answers 500 and leaves the row decided when the stamp fails, so a retry is clean", async () => {
    setup({ recommendation_cache: "update" })
    expect((await call()).status).toBe(500)
    expect(db.client.rpc).not.toHaveBeenCalled()
    expect(db.tables.recommendation_cache[0].seen_at).not.toBeNull()
  })
})
