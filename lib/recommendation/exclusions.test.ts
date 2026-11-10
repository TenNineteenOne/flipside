import { describe, it, expect } from "vitest"
import { createFakeSupabase, type Tables } from "./__fixtures__/fake-supabase"
import { isEligibleForCooldown, loadExclusions, type ExclusionPolicy } from "./exclusions"

const NOW = new Date("2026-04-20T00:00:00Z")
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 24 * 60 * 60 * 1000).toISOString()

const FEED: ExclusionPolicy = { playThreshold: 5, nameFallback: true }
const EXPLORE: ExclusionPolicy = { playThreshold: "any", nameFallback: false }

async function load(tables: Tables, policy: ExclusionPolicy) {
  const fake = createFakeSupabase({ listened_artists: [], feedback: [], recommendation_cache: [], ...tables })
  return loadExclusions(fake.client, "u1", policy, NOW)
}
const a = (id: string, name = `Artist ${id}`) => ({ id, name })

describe("loadExclusions — listened", () => {
  const listened = {
    listened_artists: [
      { user_id: "u1", artist_id: "over", play_count: 6 },
      { user_id: "u1", artist_id: "at", play_count: 5 },
      { user_id: "u1", artist_id: "zero", play_count: 0 },
      { user_id: "u1", artist_id: "nullcount", play_count: null },
      { user_id: "u1", artist_id: null, lastfm_artist_name: "Boards Of Canada", play_count: 50 },
      { user_id: "u2", artist_id: "other-user", play_count: 999 },
    ],
  }

  it("feed: hides only play_count > threshold, by id and by name key for id-less rows", async () => {
    const ex = await load(listened, FEED)
    expect(ex.reason(a("over"))).toBe("listened")
    expect(ex.reason(a("at"))).toBeNull()
    expect(ex.reason(a("zero"))).toBeNull()
    expect(ex.reason(a("nullcount"))).toBeNull()
    expect(ex.reason(a("x", "boards of canada"))).toBe("listened")
    expect(ex.reason(a("other-user"))).toBeNull()
  })

  it("explore: ANY listened row hides (owner decision #3), ids only", async () => {
    const ex = await load(listened, EXPLORE)
    for (const id of ["over", "at", "zero", "nullcount"]) expect(ex.reason(a(id))).toBe("listened")
    expect(ex.reason(a("x", "Boards Of Canada"))).toBeNull()
    expect(ex.reason(a("other-user"))).toBeNull()
  })
})

describe("loadExclusions — feedback + cooldown", () => {
  const tables: Tables = {
    feedback: [
      { user_id: "u1", artist_id: "down", signal: "thumbs_down", deleted_at: null },
      { user_id: "u1", artist_id: "undone", signal: "thumbs_down", deleted_at: daysAgo(1) },
      { user_id: "u1", artist_id: "up", signal: "thumbs_up", deleted_at: null },
    ],
    recommendation_cache: [
      { user_id: "u1", artist_id: "seen6", seen_at: daysAgo(6), skip_at: null },
      { user_id: "u1", artist_id: "seen8", seen_at: daysAgo(8), skip_at: null },
      { user_id: "u1", artist_id: "skipped", seen_at: daysAgo(100), skip_at: daysAgo(100) },
      { user_id: "u1", artist_id: "fresh", seen_at: null, skip_at: null },
    ],
    listened_artists: [{ user_id: "u1", artist_id: "down", play_count: 99 }],
  }

  it("thumbs-down (active only), 7-day seen cooldown, and permanent dismiss — same for both policies", async () => {
    for (const policy of [FEED, EXPLORE]) {
      const ex = await load(tables, policy)
      expect(ex.reason(a("down"))).toBe("thumbs_down") // thumbs_down wins over listened
      expect(ex.reason(a("undone"))).toBeNull()
      expect(ex.reason(a("up"))).toBeNull()
      expect(ex.reason(a("seen6"))).toBe("cooldown")
      expect(ex.reason(a("seen8"))).toBeNull()
      expect(ex.reason(a("skipped"))).toBe("cooldown")
      expect(ex.reason(a("fresh"))).toBeNull()
    }
  })

  it("liked policy (#175 F-B): thumbs-up and saved artists are hidden", async () => {
    const ex = await load({ ...tables, saves: [{ user_id: "u1", artist_id: "saved" }] }, { ...FEED, liked: true })
    expect(ex.reason(a("up"))).toBe("liked")
    expect(ex.reason(a("saved"))).toBe("liked")
    expect(ex.reason(a("seen8"))).toBeNull()
  })
})

describe("loadExclusions — reads past the 1000-row cap (#175 F16)", () => {
  it("pages listened, thumbs-down and cooldown reads until a short page", async () => {
    const many = (n: number, mk: (i: number) => Record<string, unknown>) =>
      Array.from({ length: n }, (_, i) => ({ id: `r${String(i).padStart(5, "0")}`, user_id: "u1", ...mk(i) }))
    const fake = createFakeSupabase({
      listened_artists: many(2500, (i) => ({ artist_id: `l${i}`, play_count: 99 })),
      feedback: many(1200, (i) => ({ artist_id: `d${i}`, signal: "thumbs_down", deleted_at: null })),
      recommendation_cache: many(1001, (i) => ({ artist_id: `s${i}`, seen_at: null, skip_at: daysAgo(30) })),
    })
    const ex = await loadExclusions(fake.client, "u1", FEED, NOW)
    expect(ex.reason(a("l2499"))).toBe("listened")
    expect(ex.reason(a("d1199"))).toBe("thumbs_down")
    expect(ex.reason(a("s1000"))).toBe("cooldown")
    // 2500 rows -> pages of 1000, 1000, 500.
    expect(fake.queries.filter((q) => q.table === "listened_artists")).toHaveLength(3)
  })
})

describe("loadExclusions — keyset paging (#175 R8)", () => {
  it("a row removed before the cursor mid-read never makes a later row go missing", async () => {
    const fake = createFakeSupabase({
      listened_artists: Array.from({ length: 2000 }, (_, i) => ({
        id: `r${String(i).padStart(5, "0")}`, user_id: "u1", artist_id: `l${i}`, play_count: 99,
      })),
      feedback: [],
      recommendation_cache: [],
    })
    // After the first page is served, a row from that page is deleted (e.g. a
    // re-sync). Offset paging would then start page 2 one row late and skip l1000.
    const from = fake.client.from
    let pages = 0
    fake.client.from = (t: string) => {
      const q = from(t)
      if (t !== "listened_artists") return q
      const then = q.then
      q.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
        then((v: unknown) => {
          if (++pages === 1) fake.tables.listened_artists.shift()
          return v
        }).then(res, rej)
      return q
    }
    const ex = await loadExclusions(fake.client, "u1", FEED, NOW)
    expect(ex.reason(a("l1000"))).toBe("listened")
    expect(ex.reason(a("l1999"))).toBe("listened")
  })
})

describe("isEligibleForCooldown", () => {
  const now = new Date("2026-04-20T00:00:00Z")

  it("allows candidates with no history", () => {
    expect(isEligibleForCooldown(null, null, now)).toBe(true)
    expect(isEligibleForCooldown(undefined, undefined, now)).toBe(true)
  })

  it("blocks when seen_at is within 7 days", () => {
    const sixDays = new Date(now.getTime() - 6 * 86400_000).toISOString()
    expect(isEligibleForCooldown(sixDays, null, now)).toBe(false)
  })

  it("allows when seen_at is past 7 days", () => {
    const eightDays = new Date(now.getTime() - 8 * 86400_000).toISOString()
    expect(isEligibleForCooldown(eightDays, null, now)).toBe(true)
  })

  it("blocks when skip_at is set recently (permanent dismiss)", () => {
    const fifteenDays = new Date(now.getTime() - 15 * 86400_000).toISOString()
    expect(isEligibleForCooldown(null, fifteenDays, now)).toBe(false)
  })

  it("blocks when skip_at is set long ago (permanent dismiss, no expiry)", () => {
    const hundredDays = new Date(now.getTime() - 100 * 86400_000).toISOString()
    expect(isEligibleForCooldown(null, hundredDays, now)).toBe(false)
  })

  it("skip cooldown outranks seen cooldown (any skip_at blocks regardless of age)", () => {
    const seen = new Date(now.getTime() - 1 * 86400_000).toISOString()
    const skip = new Date(now.getTime() - 28 * 86400_000).toISOString()
    expect(isEligibleForCooldown(seen, skip, now)).toBe(false)
  })
})
