/** #175: /stats reads artist metadata from `artists`, and Discovered never shrinks. */
import { describe, it, expect } from "vitest"
import { createRouteFakeDb } from "@/lib/api/__fixtures__/route-fake-db"
import { loadStats } from "./stats-data"

const art = (id: string, name: string, genres: string[], popularity: number | null = 50) => ({ id, name, name_lower: name.toLowerCase(), genres, popularity })
const fb = (artist_id: string, signal: string, deleted_at: string | null = null, user_id = "u1") => ({ id: `f-${artist_id}-${user_id}`, user_id, artist_id, signal, deleted_at })

describe("loadStats", () => {
  it("assembles from artists by id, even with no recommendation_cache rows (Explore / pruned)", async () => {
    const db = createRouteFakeDb({
      artists: [art("a1", "Alpha", ["indie", "rock"], 30), art("a2", "Beta", ["indie"], null), art("a3", "Gamma", ["jazz"], 70), art("a4", "Delta", ["pop"])],
      feedback: [fb("a1", "thumbs_up"), fb("a2", "thumbs_up"), fb("a3", "thumbs_up"), fb("a4", "thumbs_down"), fb("a1", "thumbs_up", null, "u2")],
      saves: [{ id: "s1", user_id: "u1", artist_id: "a3" }],
      recommendation_cache: [],
    })
    const s = await loadStats(db.client, "u1")
    expect(s.totalLikes).toBe(3)
    expect(s.totalDislikes).toBe(1)
    expect(s.totalSaves).toBe(1)
    expect(s.topGenres).toEqual([{ genre: "indie", count: 2 }, { genre: "rock", count: 1 }, { genre: "jazz", count: 1 }])
    expect(s.savedArtists).toEqual([{ name: "Gamma", popularity: 70 }])
    expect(s.likedArtists.sort((a, b) => a.name.localeCompare(b.name))).toEqual([
      { name: "Alpha", popularity: 30 },
      { name: "Beta", popularity: 0 },
    ])
  })

  it("Discovered = distinct seen cache rows ∪ all feedback (incl. un-thumbed) ∪ saves", async () => {
    const db = createRouteFakeDb({
      artists: [],
      recommendation_cache: [
        { id: "r1", user_id: "u1", artist_id: "a1", seen_at: "2026-10-01T00:00:00Z" },
        { id: "r2", user_id: "u1", artist_id: "a2", seen_at: null },
        { id: "r3", user_id: "u2", artist_id: "a9", seen_at: "2026-10-01T00:00:00Z" },
      ],
      feedback: [fb("a1", "thumbs_up"), fb("a3", "thumbs_down"), fb("a4", "thumbs_up", "2026-10-02T00:00:00Z")],
      saves: [{ id: "s1", user_id: "u1", artist_id: "a5" }],
    })
    expect((await loadStats(db.client, "u1")).totalDiscovered).toBe(4) // a1, a3, a4, a5
  })

  it("chunks the artists read at ≤500 ids", async () => {
    const n = 1200
    const ids = Array.from({ length: n }, (_, i) => `a${i}`)
    const db = createRouteFakeDb({
      artists: ids.map((id) => art(id, id, ["g"])),
      feedback: ids.map((id) => fb(id, "thumbs_up")),
      saves: [],
      recommendation_cache: [],
    })
    const s = await loadStats(db.client, "u1")
    expect(s.likedArtists).toHaveLength(n)
    expect(s.topGenres).toEqual([{ genre: "g", count: n }])
    expect(db.log.filter((l) => l.table === "artists")).toHaveLength(3)
  })
})
