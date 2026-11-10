import { describe, it, expect, vi, beforeEach } from "vitest"
import { createRouteFakeDb } from "@/lib/api/__fixtures__/route-fake-db"
import type { MbExternalIds, MbResult } from "@/lib/artist-identity/musicbrainz"

let db: ReturnType<typeof createRouteFakeDb>
vi.mock("@/lib/supabase/server", () => ({ createServiceClient: () => db.client }))
vi.mock("@/lib/auth", () => ({ safeAuth: vi.fn() }))

const mb = vi.hoisted(() => ({
  search: new Map<string, unknown>(),
  rels: new Map<string, unknown>(),
  searched: [] as string[],
}))
vi.mock("@/lib/artist-identity/musicbrainz", () => ({
  lookupArtistMbid: async (name: string) => {
    mb.searched.push(name)
    return mb.search.get(name) ?? { ok: true, value: null }
  },
  lookupArtistExternalIds: async (mbid: string) => mb.rels.get(mbid) ?? { ok: true, value: ids() },
}))

import { GET } from "./route"

const DAY = 86_400_000
const call = () =>
  GET(new Request("https://flipside.test/api/cron/mb-backfill", { headers: { authorization: "Bearer s3cret" } }))
const ids = (spotifyId: string | null = null): MbExternalIds => ({ spotifyId, appleId: null, deezerId: null })
const ok = <T>(value: T): MbResult<T> => ({ ok: true, value })
const TRANSIENT = { ok: false, transient: true }
const row = (id: string, name: string, extra: Record<string, unknown> = {}) => ({
  id, name, spotify_id: null, mbid: null, mbid_attempted_at: null, ...extra,
})
const byId = (id: string) => db.tables.artists.find((r) => r.id === id)!

beforeEach(() => {
  process.env.CRON_SECRET = "s3cret"
  vi.spyOn(console, "log").mockImplementation(() => {})
  mb.search.clear()
  mb.rels.clear()
  mb.searched = []
})

describe("GET /api/cron/mb-backfill (#175)", () => {
  it("a transient MB failure is retried after ~1 day, not 14; a genuine no-match waits the full interval", async () => {
    db = createRouteFakeDb({ artists: [row("a", "Down"), row("b", "Nobody"), row("c", "HalfDown")] })
    mb.search.set("Down", TRANSIENT)
    mb.search.set("Nobody", ok(null))
    mb.search.set("HalfDown", ok("mb-c"))
    mb.rels.set("mb-c", TRANSIENT)

    const res = await call()
    expect((await res.json()).transient).toBe(2)

    const age = (id: string) => (Date.now() - Date.parse(byId(id).mbid_attempted_at)) / DAY
    expect(age("a")).toBeGreaterThan(12.9) // re-queued once 14 days have "passed": tomorrow
    expect(age("b")).toBeLessThan(0.1) // definitive no-match: stamped now → 14 days
    expect(age("c")).toBeGreaterThan(12.9)
    expect(byId("c").mbid).toBe("mb-c") // kept; the retry reuses it
    expect(byId("c").spotify_id).toBeNull()
  })

  it("a row that already has an mbid reuses it for url-rels and never re-searches by name", async () => {
    db = createRouteFakeDb({ artists: [row("a", "Homonym", { mbid: "mb-real" })] })
    mb.search.set("Homonym", ok("mb-other"))
    mb.rels.set("mb-real", ok(ids("sp22charsAAAAAAAAAAAAAA")))

    await call()

    expect(mb.searched).toEqual([])
    expect(byId("a").mbid).toBe("mb-real")
    expect(byId("a").spotify_id).toBe("sp22charsAAAAAAAAAAAAAA")
  })
})
