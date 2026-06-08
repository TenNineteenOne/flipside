import { describe, it, expect } from "vitest"
import { ensureArtists, ensureArtist, type ArtistsSupabaseClient } from "./artists"

interface Row { id: string; spotify_id: string | null; name: string; name_lower?: string; popularity?: number | null }

/** In-memory fake of the minimal Supabase surface ensureArtists uses. */
function makeClient(
  initial: Row[] = [],
  opts: { failUpsert?: boolean; failSelect?: boolean; failByNameSelect?: boolean; failInsert?: boolean } = {},
) {
  const rows: Row[] = [...initial]
  let seq = 0
  const client: ArtistsSupabaseClient = {
    from() {
      return {
        async upsert(newRows, options) {
          if (opts.failUpsert) return { error: { message: "upsert boom" } }
          for (const r of newRows) {
            const existing = rows.find((x) => x.spotify_id === r.spotify_id)
            if (existing) {
              if (!options.ignoreDuplicates) Object.assign(existing, { name: r.name })
              continue
            }
            rows.push({ id: `uuid-${++seq}`, spotify_id: r.spotify_id, name: r.name, name_lower: r.name_lower })
          }
          return { error: null }
        },
        select() {
          return {
            async in(column, values) {
              if (opts.failSelect) return { data: null, error: { message: "select boom" } }
              const data = rows
                .filter((x) => values.includes((x as unknown as Record<string, unknown>)[column] as string))
                .map((x) => ({ id: x.id, spotify_id: x.spotify_id }))
              return { data, error: null }
            },
            eq(column, value) {
              return {
                async limit(_n: number) {
                  if (opts.failByNameSelect) return { data: null, error: { message: "by-name boom" } }
                  const data = rows
                    .filter((x) => (x as unknown as Record<string, unknown>)[column] === value)
                    .map((x) => ({ id: x.id, spotify_id: x.spotify_id, popularity: x.popularity ?? null }))
                  return { data, error: null }
                },
              }
            },
          }
        },
        insert(row) {
          return {
            select() {
              return {
                async single() {
                  if (opts.failInsert) return { data: null, error: { message: "insert boom" } }
                  const newRow: Row = {
                    id: `uuid-${++seq}`,
                    spotify_id: null,
                    name: row.name,
                    name_lower: row.name_lower,
                    popularity: row.popularity,
                  }
                  rows.push(newRow)
                  return { data: { id: newRow.id }, error: null }
                },
              }
            },
          }
        },
      }
    },
  }
  return { client, rows }
}

describe("ensureArtists", () => {
  it("mints new artists and returns a spotifyId → uuid map", async () => {
    const { client, rows } = makeClient()
    const map = await ensureArtists(client, [
      { spotifyId: "spA", name: "Alpha" },
      { spotifyId: "spB", name: "Beta" },
    ])
    expect(map.size).toBe(2)
    expect(map.get("spA")).toBeTruthy()
    expect(map.get("spB")).toBeTruthy()
    expect(map.get("spA")).not.toBe(map.get("spB"))
    expect(rows).toHaveLength(2)
  })

  it("never clobbers an existing row's metadata, and maps to its existing id", async () => {
    const { client, rows } = makeClient([{ id: "existing-uuid", spotify_id: "spA", name: "Real Name" }])
    const map = await ensureArtists(client, [{ spotifyId: "spA", name: "PLACEHOLDER" }])
    expect(map.get("spA")).toBe("existing-uuid")
    expect(rows).toHaveLength(1)
    expect(rows[0].name).toBe("Real Name") // ignoreDuplicates → not overwritten
  })

  it("dedupes duplicate spotifyIds in the input (first-seen wins)", async () => {
    const { client, rows } = makeClient()
    const map = await ensureArtists(client, [
      { spotifyId: "spA", name: "First" },
      { spotifyId: "spA", name: "Second" },
    ])
    expect(map.size).toBe(1)
    expect(rows).toHaveLength(1)
    expect(rows[0].name).toBe("First")
  })

  it("skips seeds without a spotifyId and returns empty for an all-empty batch", async () => {
    const { client } = makeClient()
    const map = await ensureArtists(client, [{ spotifyId: "", name: "NoId" }])
    expect(map.size).toBe(0)
  })

  it("degrades to an empty/partial map (never throws) on a read failure", async () => {
    const { client } = makeClient([], { failSelect: true })
    const map = await ensureArtists(client, [{ spotifyId: "spA", name: "Alpha" }])
    expect(map.size).toBe(0) // could not read back, but did not throw
  })
})

describe("ensureArtist", () => {
  it("returns the canonical uuid for a single seed (spotify-id path)", async () => {
    const { client } = makeClient()
    const id = await ensureArtist(client, { spotifyId: "spZ", name: "Zeta" })
    expect(id).toBeTruthy()
  })
})

describe("ensureArtist — mint-by-name (no spotifyId)", () => {
  it("creates a name-only row when no existing row matches", async () => {
    const { client, rows } = makeClient()
    const id = await ensureArtist(client, { name: "Fresh Band", genres: ["indie"], popularity: 40 })
    expect(id).toBeTruthy()
    expect(rows).toHaveLength(1)
    expect(rows[0].name).toBe("Fresh Band")
    expect(rows[0].name_lower).toBe("fresh band")
    expect(rows[0].spotify_id).toBeNull() // minted WITHOUT a spotify_id (#159 backfills)
  })

  it("treats a null spotifyId the same as absent (mint by name)", async () => {
    const { client, rows } = makeClient()
    const id = await ensureArtist(client, { spotifyId: null, name: "Nully" })
    expect(id).toBeTruthy()
    expect(rows).toHaveLength(1)
  })

  it("reuses an existing row by name_lower instead of inserting a duplicate", async () => {
    const { client, rows } = makeClient([
      { id: "existing-uuid", spotify_id: "spX", name: "Khruangbin", name_lower: "khruangbin", popularity: 60 },
    ])
    const id = await ensureArtist(client, { name: "khruangbin" }) // different casing
    expect(id).toBe("existing-uuid")
    expect(rows).toHaveLength(1) // no duplicate minted
  })

  it("reuses the best row when multiple match: spotify_id NOT NULL first, then popularity", async () => {
    const { client, rows } = makeClient([
      { id: "no-sp-high", spotify_id: null, name: "Dup", name_lower: "dup", popularity: 90 },
      { id: "sp-low", spotify_id: "spA", name: "Dup", name_lower: "dup", popularity: 10 },
      { id: "no-sp-low", spotify_id: null, name: "Dup", name_lower: "dup", popularity: 5 },
    ])
    const id = await ensureArtist(client, { name: "Dup" })
    // spotify_id NOT NULL wins even though its popularity is lowest.
    expect(id).toBe("sp-low")
    expect(rows).toHaveLength(3)
  })

  it("picks highest popularity among rows that all have a spotify_id", async () => {
    const { client } = makeClient([
      { id: "low", spotify_id: "spA", name: "Dup", name_lower: "dup", popularity: 20 },
      { id: "high", spotify_id: "spB", name: "Dup", name_lower: "dup", popularity: 80 },
    ])
    const id = await ensureArtist(client, { name: "Dup" })
    expect(id).toBe("high")
  })

  it("returns null (never throws) on a by-name read failure", async () => {
    const { client } = makeClient([], { failByNameSelect: true })
    const id = await ensureArtist(client, { name: "Boom" })
    expect(id).toBeNull()
  })

  it("returns null (never throws) on an insert failure", async () => {
    const { client } = makeClient([], { failInsert: true })
    const id = await ensureArtist(client, { name: "Boom" })
    expect(id).toBeNull()
  })
})
