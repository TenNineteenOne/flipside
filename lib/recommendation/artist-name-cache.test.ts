import { describe, it, expect, vi, beforeEach } from "vitest"
import { ArtistNameCache, type CacheSupabaseClient, type ArtistsRow } from "./artist-name-cache"
import type { Artist } from "@/lib/music-provider/types"

function artist(id: string, name: string, spotifyId: string | null = `sp-${id}`): Artist {
  return { id, spotifyId, name, genres: [], imageUrl: null, popularity: 50 }
}

/** Build a folded `artists` row. */
function row(opts: {
  id: string
  spotifyId?: string | null
  name: string
  genres?: string[] | null
  popularity?: number | null
  imageUrl?: string | null
}): ArtistsRow {
  return {
    id: opts.id,
    spotify_id: opts.spotifyId ?? `sp-${opts.id}`,
    name: opts.name,
    name_lower: opts.name.toLowerCase(),
    genres: opts.genres === undefined ? [] : opts.genres,
    popularity: opts.popularity === undefined ? 50 : opts.popularity,
    image_url: opts.imageUrl ?? null,
  }
}

/** Captured upsert payload shape. */
interface UpsertCapture {
  row: {
    spotify_id: string | null
    name: string
    name_lower: string
    genres: string[]
    popularity: number
    image_url: string | null
  }
  options: { onConflict?: string; ignoreDuplicates?: boolean }
}

/** Captured update payload shape. */
interface UpdateCapture {
  values: { genres?: string[]; popularity?: number; image_url?: string }
  column: string
  value: string
}

/** In-memory fake matching the CacheSupabaseClient surface (the `artists` table). */
function makeFakeClient(opts: {
  initialRows?: ArtistsRow[]
  readError?: string
  readThrows?: boolean
  writeError?: string
  writeThrows?: boolean
} = {}): {
  client: CacheSupabaseClient
  rows: ArtistsRow[]
  upserts: UpsertCapture[]
  updates: UpdateCapture[]
} {
  const rows: ArtistsRow[] = [...(opts.initialRows ?? [])]
  const upserts: UpsertCapture[] = []
  const updates: UpdateCapture[] = []
  const client: CacheSupabaseClient = {
    from() {
      return {
        select() {
          return {
            in: async (_column: string, values: string[]) => {
              if (opts.readThrows) throw new Error("connection refused")
              if (opts.readError) return { data: null, error: { message: opts.readError } }
              const data = rows.filter((r) => values.includes(r.name_lower))
              return { data, error: null }
            },
          }
        },
        upsert: async (
          r: UpsertCapture["row"],
          options: UpsertCapture["options"],
        ) => {
          if (opts.writeThrows) throw new Error("write blew up")
          if (opts.writeError) return { error: { message: opts.writeError } }
          upserts.push({ row: r, options })
          rows.push(
            row({
              id: `minted-${r.spotify_id ?? r.name_lower}`,
              spotifyId: r.spotify_id,
              name: r.name,
              genres: r.genres,
              popularity: r.popularity,
              imageUrl: r.image_url,
            }),
          )
          return { error: null }
        },
        update(values: UpdateCapture["values"]) {
          return {
            eq: async (column: string, value: string) => {
              if (opts.writeThrows) throw new Error("write blew up")
              if (opts.writeError) return { error: { message: opts.writeError } }
              updates.push({ values, column, value })
              const target = rows.find((r) => r.id === value)
              if (target) {
                if (values.genres) target.genres = values.genres
                if (values.popularity !== undefined) target.popularity = values.popularity
                if (values.image_url !== undefined) target.image_url = values.image_url
              }
              return { error: null }
            },
          }
        },
      }
    },
  }
  return { client, rows, upserts, updates }
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

  it("returns all hits when every name is cached (uuid identity + spotifyId attribute)", async () => {
    const { client } = makeFakeClient({
      initialRows: [
        row({ id: "uuid-k", spotifyId: "k1", name: "Khruangbin" }),
        row({ id: "uuid-m", spotifyId: "m1", name: "Men I Trust" }),
      ],
    })
    const cache = new ArtistNameCache(client)
    const result = await cache.batchRead(["Khruangbin", "Men I Trust"])
    expect(result.size).toBe(2)
    // id is the uuid identity; spotifyId is the attribute.
    expect(result.get("khruangbin")?.id).toBe("uuid-k")
    expect(result.get("khruangbin")?.spotifyId).toBe("k1")
    expect(result.get("men i trust")?.id).toBe("uuid-m")
    expect(result.get("men i trust")?.spotifyId).toBe("m1")
  })

  it("maps row columns into the Artist shape (genres/popularity/imageUrl)", async () => {
    const { client } = makeFakeClient({
      initialRows: [
        row({
          id: "uuid-x",
          spotifyId: "x1",
          name: "X",
          genres: ["dream pop", "shoegaze"],
          popularity: 42,
          imageUrl: "https://img/x.jpg",
        }),
      ],
    })
    const cache = new ArtistNameCache(client)
    const result = await cache.batchRead(["X"])
    const a = result.get("x")!
    expect(a.genres).toEqual(["dream pop", "shoegaze"])
    expect(a.popularity).toBe(42)
    expect(a.imageUrl).toBe("https://img/x.jpg")
  })

  it("defaults null genres/popularity to []/0", async () => {
    const { client } = makeFakeClient({
      initialRows: [row({ id: "uuid-n", name: "Nully", genres: null, popularity: null })],
    })
    const cache = new ArtistNameCache(client)
    const a = (await cache.batchRead(["Nully"])).get("nully")!
    expect(a.genres).toEqual([])
    expect(a.popularity).toBe(0)
  })

  it("OMITS an ambiguous name (Option B: >1 row for a name_lower → cache miss)", async () => {
    const { client } = makeFakeClient({
      initialRows: [
        row({ id: "uuid-a1", spotifyId: "a1", name: "Nirvana" }),
        row({ id: "uuid-a2", spotifyId: "a2", name: "Nirvana" }), // same name_lower
        row({ id: "uuid-u", spotifyId: "u1", name: "Unique Artist" }),
      ],
    })
    const cache = new ArtistNameCache(client)
    const result = await cache.batchRead(["Nirvana", "Unique Artist"])
    // Ambiguous "nirvana" is dropped; the unambiguous one is kept.
    expect(result.has("nirvana")).toBe(false)
    expect(result.get("unique artist")?.id).toBe("uuid-u")
    expect(result.size).toBe(1)
  })

  it("returns empty map when no names are cached", async () => {
    const { client } = makeFakeClient()
    const cache = new ArtistNameCache(client)
    const result = await cache.batchRead(["Unknown One", "Unknown Two"])
    expect(result.size).toBe(0)
  })

  it("returns partial hits for mixed input", async () => {
    const { client } = makeFakeClient({
      initialRows: [row({ id: "uuid-k", spotifyId: "k1", name: "Khruangbin" })],
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

  it("chunks large inputs so a single .in() call can't trip URI-too-large", async () => {
    const initialRows: ArtistsRow[] = Array.from({ length: 1500 }, (_, i) =>
      row({ id: `uuid${i}`, spotifyId: `id${i}`, name: `Artist ${i}` }),
    )
    const rows = [...initialRows]
    let inCalls = 0
    const client: CacheSupabaseClient = {
      from() {
        return {
          select() {
            return {
              in: async (_column: string, values: string[]) => {
                inCalls++
                const data = rows.filter((r) => values.includes(r.name_lower))
                return { data, error: null }
              },
            }
          },
          upsert: async () => ({ error: null }),
          update: () => ({ eq: async () => ({ error: null }) }),
        }
      },
    }
    const cache = new ArtistNameCache(client)
    const inputNames = Array.from({ length: 1500 }, (_, i) => `Artist ${i}`)
    const result = await cache.batchRead(inputNames)
    expect(result.size).toBe(1500)
    expect(inCalls).toBe(3) // 1500 / 500 = 3 chunks
  })

  it("lowercases the lookup so case differences hit", async () => {
    const { client } = makeFakeClient({
      initialRows: [row({ id: "uuid-k", spotifyId: "k1", name: "Khruangbin" })],
    })
    const cache = new ArtistNameCache(client)
    const result = await cache.batchRead(["KHRUANGBIN"])
    expect(result.get("khruangbin")?.id).toBe("uuid-k")
  })
})

describe("ArtistNameCache.write", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {})
  })

  it("no minted uuid: insert-if-absent on spotify_id (never a clobbering upsert), then fill-only refresh", async () => {
    const { client, upserts, updates } = makeFakeClient()
    const cache = new ArtistNameCache(client)
    await cache.write("Khruangbin", artist("not-a-uuid", "Khruangbin", "k1"))
    expect(upserts).toHaveLength(1)
    expect(upserts[0].row.name_lower).toBe("khruangbin")
    // spotify_id is the Spotify attribute, NOT the uuid identity.
    expect(upserts[0].row.spotify_id).toBe("k1")
    expect(upserts[0].row.spotify_id).not.toBe("not-a-uuid")
    expect(upserts[0].options.onConflict).toBe("spotify_id")
    // Same non-clobber contract as ensureArtists: never overwrite an existing
    // row via upsert; metadata refresh happens as a separate fill-only patch.
    expect(upserts[0].options.ignoreDuplicates).toBe(true)
    expect(updates).toHaveLength(1)
    expect(updates[0].column).toBe("spotify_id")
    expect(updates[0].value).toBe("k1")
    expect(updates[0].values).toEqual({ popularity: 50 }) // genres [] / null image not written
  })

  it("minted uuid identity wins over spotifyId: fill-only update by id, no upsert (C5)", async () => {
    const UUID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
    const existing = row({ id: UUID, spotifyId: "k1", name: "Khruangbin" })
    const { client, upserts, updates, rows } = makeFakeClient({ initialRows: [existing] })
    const cache = new ArtistNameCache(client)
    await cache.write("Khruangbin", {
      id: UUID,
      spotifyId: "k1",
      name: "khruangbin (alt spelling)",
      genres: ["psych"],
      popularity: 61,
      imageUrl: "https://img/k.jpg",
    })
    expect(upserts).toHaveLength(0)
    expect(updates).toHaveLength(1)
    expect(updates[0].column).toBe("id")
    expect(updates[0].value).toBe(UUID)
    // name/name_lower are never touched — the canonical spelling survives.
    expect(rows[0].name).toBe("Khruangbin")
    expect(rows[0].genres).toEqual(["psych"])
  })

  it("when spotifyId is null, UPDATES the minted identity row by id — never inserts (#161)", async () => {
    const existing = row({ id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", spotifyId: null, name: "Lastfm Only", genres: null, popularity: null })
    const { client, rows, upserts, updates } = makeFakeClient({ initialRows: [existing] })
    const cache = new ArtistNameCache(client)
    const a: Artist = {
      id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      spotifyId: null,
      name: "Lastfm Only",
      genres: ["shoegaze"],
      popularity: 33,
      imageUrl: "https://img/l.jpg",
    }
    await cache.write("Lastfm Only", a)
    // No insert path at all: a duplicate row here made the name permanently
    // ambiguous (>1 row per name_lower → batchRead miss).
    expect(upserts).toHaveLength(0)
    expect(rows).toHaveLength(1)
    expect(updates).toHaveLength(1)
    expect(updates[0].column).toBe("id")
    expect(updates[0].value).toBe("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb")
    expect(rows[0].genres).toEqual(["shoegaze"])
    expect(rows[0].popularity).toBe(33)
    expect(rows[0].image_url).toBe("https://img/l.jpg")
  })

  it("null-spotifyId update is fill-only: empty/zero fields are not written", async () => {
    const { client, updates, upserts } = makeFakeClient({
      initialRows: [row({ id: "uuid-e", spotifyId: null, name: "Empty" })],
    })
    const cache = new ArtistNameCache(client)
    await cache.write("Empty", { id: "uuid-e", spotifyId: null, name: "Empty", genres: [], popularity: 0, imageUrl: null })
    expect(updates).toHaveLength(0)
    expect(upserts).toHaveLength(0)
  })

  it("skips entirely when there is neither a spotifyId nor a minted id", async () => {
    const { client, updates, upserts, rows } = makeFakeClient()
    const cache = new ArtistNameCache(client)
    await cache.write("Ghost", { id: "", spotifyId: null, name: "Ghost", genres: ["ambient"], popularity: 10, imageUrl: null })
    expect(updates).toHaveLength(0)
    expect(upserts).toHaveLength(0)
    expect(rows).toHaveLength(0)
  })

  it("does not throw when the null-spotifyId update returns an error", async () => {
    const { client } = makeFakeClient({ writeError: "permission denied" })
    const cache = new ArtistNameCache(client)
    await expect(
      cache.write("X", { id: "uuid-x", spotifyId: null, name: "X", genres: ["g"], popularity: 5, imageUrl: null }),
    ).resolves.toBeUndefined()
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
