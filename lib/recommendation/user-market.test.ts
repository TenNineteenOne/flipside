import { describe, it, expect, vi, beforeEach } from "vitest"
import { getOrFetchUserMarket, type MarketDeps } from "./user-market"

function makeDeps(over: Partial<MarketDeps> & { writes?: Map<string, string> } = {}): MarketDeps & { writes: Map<string, string> } {
  const writes = over.writes ?? new Map<string, string>()
  return {
    readMarket: over.readMarket ?? (async () => null),
    writeMarket: over.writeMarket ?? (async (id, m) => { writes.set(id, m) }),
    fetchMarket: over.fetchMarket ?? (async () => "US"),
    writes,
  }
}

describe("getOrFetchUserMarket", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {})
  })

  it("returns cached market without calling Spotify", async () => {
    const fetchMarket = vi.fn(async () => "FR")
    const m = await getOrFetchUserMarket("user1", makeDeps({
      readMarket: async () => "GB",
      fetchMarket,
    }))
    expect(m).toBe("GB")
    expect(fetchMarket).not.toHaveBeenCalled()
  })

  it("fetches from Spotify and persists when cache miss", async () => {
    const deps = makeDeps({
      readMarket: async () => null,
      fetchMarket: async () => "DE",
    })
    const m = await getOrFetchUserMarket("user1", deps)
    expect(m).toBe("DE")
    expect(deps.writes.get("user1")).toBe("DE")
  })

  it("falls through to Spotify when DB read throws", async () => {
    const deps = makeDeps({
      readMarket: async () => { throw new Error("boom") },
      fetchMarket: async () => "JP",
    })
    const m = await getOrFetchUserMarket("user1", deps)
    expect(m).toBe("JP")
    expect(deps.writes.get("user1")).toBe("JP")
  })

  it("returns US when Spotify fetch throws", async () => {
    const m = await getOrFetchUserMarket("user1", makeDeps({
      fetchMarket: async () => { throw new Error("nope") },
    }))
    expect(m).toBe("US")
  })

  it("does not throw when write fails", async () => {
    const m = await getOrFetchUserMarket("user1", makeDeps({
      fetchMarket: async () => "CA",
      writeMarket: async () => { throw new Error("write boom") },
    }))
    expect(m).toBe("CA")
  })
})
