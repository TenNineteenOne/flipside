import { describe, it, expect } from "vitest"
import { getHistoryPage } from "./query"

interface CacheRow {
  artist_id: string
  artist_data: Record<string, unknown>
  score: number
  why: Record<string, unknown>
  seen_at: string
  skip_at: string | null
  user_id: string
}

/** Minimal in-memory fake covering exactly the query shapes getHistoryPage uses. */
function makeSupabase(opts: {
  cache: CacheRow[]
  feedback?: { user_id: string; artist_id: string; signal: string; deleted_at: string | null }[]
  saves?: { user_id: string; artist_id: string }[]
}) {
  const feedback = opts.feedback ?? []
  const saves = opts.saves ?? []

  return {
    from(table: string) {
      if (table === "recommendation_cache") {
        return {
          select() {
            return {
              eq(_col: string, userId: string) {
                return {
                  not() {
                    return {
                      order() {
                        return {
                          async range(from: number, to: number) {
                            const rows = opts.cache
                              .filter((r) => r.user_id === userId && r.seen_at != null)
                              .sort((a, b) => (a.seen_at < b.seen_at ? 1 : -1))
                              .slice(from, to + 1)
                            return { data: rows, error: null }
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
      }
      if (table === "feedback") {
        return {
          select() {
            return {
              eq(_col: string, userId: string) {
                return {
                  is() {
                    return {
                      async in(_col2: string, ids: string[]) {
                        const data = feedback.filter(
                          (f) => f.user_id === userId && f.deleted_at === null && ids.includes(f.artist_id)
                        )
                        return { data, error: null }
                      },
                    }
                  },
                }
              },
            }
          },
        }
      }
      if (table === "saves") {
        return {
          select() {
            return {
              eq(_col: string, userId: string) {
                return {
                  async in(_col2: string, ids: string[]) {
                    const data = saves.filter((s) => s.user_id === userId && ids.includes(s.artist_id))
                    return { data, error: null }
                  },
                }
              },
            }
          },
        }
      }
      throw new Error(`unexpected table ${table}`)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any
}

function row(over: Partial<CacheRow>): CacheRow {
  return {
    artist_id: "artist-1",
    artist_data: { id: "artist-1", name: "Radiohead" },
    score: 0.5,
    why: { sourceArtists: [], genres: [], friendBoost: [] },
    seen_at: "2026-01-01T00:00:00.000Z",
    skip_at: null,
    user_id: "user-1",
    ...over,
  }
}

describe("getHistoryPage — hasMore boundary", () => {
  it("returns hasMore=false when exactly `limit` rows are left", async () => {
    const cache = Array.from({ length: 5 }, (_, i) =>
      row({ artist_id: `a${i}`, seen_at: `2026-01-0${i + 1}T00:00:00.000Z` })
    )
    const supabase = makeSupabase({ cache })
    const { history, hasMore } = await getHistoryPage(supabase, "user-1", { offset: 0, limit: 5 })
    expect(history).toHaveLength(5)
    expect(hasMore).toBe(false)
  })

  it("returns hasMore=true when limit+1 rows exist", async () => {
    const cache = Array.from({ length: 6 }, (_, i) =>
      row({ artist_id: `a${i}`, seen_at: `2026-01-0${i + 1}T00:00:00.000Z` })
    )
    const supabase = makeSupabase({ cache })
    const { history, hasMore } = await getHistoryPage(supabase, "user-1", { offset: 0, limit: 5 })
    expect(history).toHaveLength(5)
    expect(hasMore).toBe(true)
  })
})

describe("getHistoryPage — signal precedence", () => {
  it("feedback signal wins over skip_at", async () => {
    const cache = [row({ artist_id: "a1", skip_at: "2026-01-01T00:00:00.000Z" })]
    const feedback = [{ user_id: "user-1", artist_id: "a1", signal: "thumbs_up", deleted_at: null }]
    const supabase = makeSupabase({ cache, feedback })
    const { history } = await getHistoryPage(supabase, "user-1", { offset: 0, limit: 10 })
    expect(history[0].signal).toBe("thumbs_up")
  })

  it("skip_at maps to dismissed when no feedback", async () => {
    const cache = [row({ artist_id: "a1", skip_at: "2026-01-01T00:00:00.000Z" })]
    const supabase = makeSupabase({ cache })
    const { history } = await getHistoryPage(supabase, "user-1", { offset: 0, limit: 10 })
    expect(history[0].signal).toBe("dismissed")
  })

  it("falls back to skip when neither feedback nor skip_at", async () => {
    const cache = [row({ artist_id: "a1", skip_at: null })]
    const supabase = makeSupabase({ cache })
    const { history } = await getHistoryPage(supabase, "user-1", { offset: 0, limit: 10 })
    expect(history[0].signal).toBe("skip")
  })
})

describe("getHistoryPage — bookmarked flag", () => {
  it("marks bookmarked=true when a saves row exists for the artist", async () => {
    const cache = [row({ artist_id: "a1" })]
    const saves = [{ user_id: "user-1", artist_id: "a1" }]
    const supabase = makeSupabase({ cache, saves })
    const { history } = await getHistoryPage(supabase, "user-1", { offset: 0, limit: 10 })
    expect(history[0].bookmarked).toBe(true)
  })

  it("marks bookmarked=false when no saves row exists", async () => {
    const cache = [row({ artist_id: "a1" })]
    const supabase = makeSupabase({ cache })
    const { history } = await getHistoryPage(supabase, "user-1", { offset: 0, limit: 10 })
    expect(history[0].bookmarked).toBe(false)
  })
})

describe("getHistoryPage — empty result", () => {
  it("returns empty history and hasMore=false when nothing seen", async () => {
    const supabase = makeSupabase({ cache: [] })
    const { history, hasMore } = await getHistoryPage(supabase, "user-1", { offset: 0, limit: 10 })
    expect(history).toEqual([])
    expect(hasMore).toBe(false)
  })
})
