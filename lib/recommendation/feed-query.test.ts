import { describe, it, expect } from "vitest"
import { getUnseenRecommendations } from "./feed-query"
import { UNDERGROUND_MAX_POPULARITY } from "./types"

interface Row {
  artist_id: string
  artist_data: { popularity?: number }
  score: number
  why: Record<string, unknown>
  user_id: string
}

/** Minimal in-memory fake covering the two query shapes the function uses. */
function makeSupabase(
  rows: Row[],
  users?: { underground_mode?: boolean; error?: string },
) {
  return {
    from(table: string) {
      if (table === "users") {
        return {
          select() {
            return {
              eq() {
                return {
                  async maybeSingle() {
                    if (users?.error) return { data: null, error: { message: users.error } }
                    return { data: { underground_mode: users?.underground_mode ?? false }, error: null }
                  },
                }
              },
            }
          },
        }
      }
      if (table !== "recommendation_cache") throw new Error(`unexpected table ${table}`)
      return {
        select() {
          return {
            eq(_col: string, userId: string) {
              return {
                is() {
                  return {
                    gt() {
                      return {
                        order() {
                          return {
                            async limit(n: number) {
                              const data = rows
                                .filter((r) => r.user_id === userId)
                                .sort((a, b) => b.score - a.score)
                                .slice(0, n)
                              return { data, error: null }
                            },
                          }
                        },
                      }
                    },
                  }
                },
              }
            },
          }
        },
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any
}

function row(over: Partial<Row>): Row {
  return {
    artist_id: "a1",
    artist_data: { popularity: 50 },
    score: 0.5,
    why: {},
    user_id: "user-1",
    ...over,
  }
}

describe("getUnseenRecommendations — underground filtering", () => {
  it("filters out artists above UNDERGROUND_MAX_POPULARITY when underground mode is on", async () => {
    const rows = [
      row({ artist_id: "low", artist_data: { popularity: UNDERGROUND_MAX_POPULARITY - 1 }, score: 0.9 }),
      row({ artist_id: "high", artist_data: { popularity: UNDERGROUND_MAX_POPULARITY + 1 }, score: 0.8 }),
      row({ artist_id: "boundary", artist_data: { popularity: UNDERGROUND_MAX_POPULARITY }, score: 0.7 }),
    ]
    const supabase = makeSupabase(rows)
    const result = await getUnseenRecommendations(supabase, "user-1", { limit: 20, undergroundMode: true })
    expect(result.map((r) => r.artist_id)).toEqual(["low", "boundary"])
  })

  it("keeps rows with missing popularity when underground mode is on", async () => {
    const rows = [row({ artist_id: "no-pop", artist_data: {} })]
    const supabase = makeSupabase(rows)
    const result = await getUnseenRecommendations(supabase, "user-1", { limit: 20, undergroundMode: true })
    expect(result.map((r) => r.artist_id)).toEqual(["no-pop"])
  })

  it("returns rows as-is when underground mode is off", async () => {
    const rows = [
      row({ artist_id: "low", artist_data: { popularity: 10 } }),
      row({ artist_id: "high", artist_data: { popularity: 90 } }),
    ]
    const supabase = makeSupabase(rows)
    const result = await getUnseenRecommendations(supabase, "user-1", { limit: 20, undergroundMode: false })
    expect(result.map((r) => r.artist_id)).toEqual(["low", "high"])
  })
})

describe("getUnseenRecommendations — internal underground_mode lookup", () => {
  it("when undergroundMode is omitted, reads users.underground_mode itself and filters", async () => {
    const rows = [
      row({ artist_id: "low", artist_data: { popularity: 10 }, score: 0.9 }),
      row({ artist_id: "high", artist_data: { popularity: 90 }, score: 0.8 }),
    ]
    const supabase = makeSupabase(rows, { underground_mode: true })
    const result = await getUnseenRecommendations(supabase, "user-1", { limit: 20 })
    expect(result.map((r) => r.artist_id)).toEqual(["low"])
  })

  it("degrades to unfiltered when the user lookup errors", async () => {
    const rows = [row({ artist_id: "high", artist_data: { popularity: 90 } })]
    const supabase = makeSupabase(rows, { error: "boom" })
    const result = await getUnseenRecommendations(supabase, "user-1", { limit: 20 })
    expect(result.map((r) => r.artist_id)).toEqual(["high"])
  })
})

describe("getUnseenRecommendations — slice length", () => {
  it("slices down to the requested limit after filtering", async () => {
    const rows = Array.from({ length: 10 }, (_, i) =>
      row({ artist_id: `a${i}`, score: 1 - i * 0.01, artist_data: { popularity: 10 } })
    )
    const supabase = makeSupabase(rows)
    const result = await getUnseenRecommendations(supabase, "user-1", { limit: 3, undergroundMode: false })
    expect(result).toHaveLength(3)
    expect(result.map((r) => r.artist_id)).toEqual(["a0", "a1", "a2"])
  })

  it("returns fewer than limit when filtering leaves fewer rows than limit", async () => {
    const rows = [
      row({ artist_id: "keep", artist_data: { popularity: 10 } }),
      row({ artist_id: "drop", artist_data: { popularity: 90 } }),
    ]
    const supabase = makeSupabase(rows)
    const result = await getUnseenRecommendations(supabase, "user-1", { limit: 20, undergroundMode: true })
    expect(result).toHaveLength(1)
    expect(result[0].artist_id).toBe("keep")
  })
})
