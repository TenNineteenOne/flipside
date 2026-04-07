import { describe, it, expect, vi, beforeEach } from "vitest"
import { ArtistNameCache, type CacheSupabaseClient } from "./artist-name-cache"
import type { Artist } from "@/lib/music-provider/types"

function artist(id: string, name: string): Artist {
  return { id, name, genres: [], imageUrl: null, popularity: 50 }
}

interface FakeRow {
  name_lower: string
  spotify_artist_id: string
  artist_name: string
  artist_data: Artist
}

/** In-memory fake matching the CacheSupabaseClient surface. */
function makeFakeClient(opts: {
  initialRows?: FakeRow[]
  readError?: string
  readThrows?: boolean
  writeError?: string
  writeThrows?: boolean
} = {}): { client: CacheSupabaseClient; rows: FakeRow[] } {
  const rows: FakeRow[] = [...(opts.initialRows ?? [])]
  const client: CacheSupabaseClient = {
    from() {
      return {
        select() {
          return {
            in: async (_column: string, values: string[]) => {
              if (opts.readThrows) throw new Error("connection refused")
              if (opts.readError) return { data: null, error: { message: opts.readError } }
              const data = rows
                .filter((r) => values.includes(r.name_lower))
                .map((r) => ({ name_lower: r.name_lower, artist_data: r.artist_data }))
              return { data, error: null }
            },
          }
        },
        upsert: async (row: FakeRow, _opts: { onConflict: string }) => {
          if (opts.writeThrows) throw new Error("write blew up")
          if (opts.writeError) return { error: { message: opts.writeError } }
          const idx = rows.findIndex((r) => r.name_lower === row.name_lower)
          if (idx >= 0) rows[idx] = row
          else rows.push(row)
          return { error: null }
        },
      }
    },
  }
  return { client, rows }
}

describe("ArtistNameCache.batchRead", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {})
  })

  it("returns empty map for empty input", async () => {
    const { client } = makeFakeClient()
    const cache = new ArtistNameCache(client)
    const result = await cache.batchRead([])
    expect(result.size).toBe(0)
  })

  it("returns all hits when every name is cached", async () => {
    const { client } = makeFakeClient({
      initialRows: [
        { name_lower: "khruangbin", spotify_artist_id: "k1", artist_name: "Khruangbin", artist_data: artist("k1", "Khruangbin") },
        { name_lower: "men i trust", spotify_artist_id: "m1", artist_name: "Men I Trust", artist_data: artist("m1", "Men I Trust") },
      ],
    })
    const cache = new ArtistNameCache(client)
    const result = await cache.batchRead(["Khruangbin", "Men I Trust"])
    expect(result.size).toBe(2)
    expect(result.get("khruangbin")?.id).toBe("k1")
    expect(result.get("men i trust")?.id).toBe("m1")
  })

  it("returns empty map when no names are cached", async () => {
    const { client } = makeFakeClient()
    const cache = new ArtistNameCache(client)
    const result = await cache.batchRead(["Unknown One", "Unknown Two"])
    expect(result.size).toBe(0)
  })

  it("returns partial hits for mixed input", async () => {
    const { client } = makeFakeClient({
      initialRows: [
        { name_lower: "khruangbin", spotify_artist_id: "k1", artist_name: "Khruangbin", artist_data: artist("k1", "Khruangbin") },
      ],
    })
    const cache = new ArtistNameCache(client)
    const result = await cache.batchRead(["Khruangbin", "Unknown Artist"])
    expect(result.size).toBe(1)
    expect(result.has("khruangbin")).toBe(true)
    expect(result.has("unknown artist")).toBe(false)
  })

  it("falls back to empty map when the table read returns an error", async () => {
    const { client } = makeFakeClient({ readError: "relation does not exist" })
    const cache = new ArtistNameCache(client)
    const result = await cache.batchRead(["Anything"])
    expect(result.size).toBe(0)
  })

  it("falls back to empty map when the read throws", async () => {
    const { client } = makeFakeClient({ readThrows: true })
    const cache = new ArtistNameCache(client)
    const result = await cache.batchRead(["Anything"])
    expect(result.size).toBe(0)
  })

  it("lowercases the lookup so case differences hit", async () => {
    const { client } = makeFakeClient({
      initialRows: [
        { name_lower: "khruangbin", spotify_artist_id: "k1", artist_name: "Khruangbin", artist_data: artist("k1", "Khruangbin") },
      ],
    })
    const cache = new ArtistNameCache(client)
    const result = await cache.batchRead(["KHRUANGBIN"])
    expect(result.get("khruangbin")?.id).toBe("k1")
  })
})

describe("ArtistNameCache.write", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {})
  })

  it("upserts a new entry", async () => {
    const { client, rows } = makeFakeClient()
    const cache = new ArtistNameCache(client)
    await cache.write("Khruangbin", artist("k1", "Khruangbin"))
    expect(rows).toHaveLength(1)
    expect(rows[0].name_lower).toBe("khruangbin")
    expect(rows[0].spotify_artist_id).toBe("k1")
  })

  it("does not throw when the write returns an error", async () => {
    const { client } = makeFakeClient({ writeError: "permission denied" })
    const cache = new ArtistNameCache(client)
    await expect(cache.write("X", artist("x", "X"))).resolves.toBeUndefined()
  })

  it("does not throw when the write throws", async () => {
    const { client } = makeFakeClient({ writeThrows: true })
    const cache = new ArtistNameCache(client)
    await expect(cache.write("X", artist("x", "X"))).resolves.toBeUndefined()
  })
})
