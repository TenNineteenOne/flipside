import { describe, it, expect } from "vitest"
import { ensureArtists, ensureArtist, type ArtistsSupabaseClient } from "./artists"

interface Row { id: string; spotify_id: string | null; name: string }

/** In-memory fake of the minimal Supabase surface ensureArtists uses. */
function makeClient(initial: Row[] = [], opts: { failUpsert?: boolean; failSelect?: boolean } = {}) {
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
            rows.push({ id: `uuid-${++seq}`, spotify_id: r.spotify_id, name: r.name })
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
  it("returns the canonical uuid for a single seed", async () => {
    const { client } = makeClient()
    const id = await ensureArtist(client, { spotifyId: "spZ", name: "Zeta" })
    expect(id).toBeTruthy()
  })

  it("returns null for a seed with no spotifyId", async () => {
    const { client } = makeClient()
    const id = await ensureArtist(client, { spotifyId: "", name: "NoId" })
    expect(id).toBeNull()
  })
})
