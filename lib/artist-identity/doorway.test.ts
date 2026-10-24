import { describe, it, expect, beforeEach, vi } from "vitest"
import { ArtistIdentity, type ArtistsClient } from "."
import { createFakeSupabase, type Row } from "@/lib/recommendation/__fixtures__/fake-supabase"
import type { Artist } from "@/lib/music-provider/types"

// Doorway suite: every test goes through the ArtistIdentity interface against
// the shared in-memory Supabase fake.

const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`

function row(id: string, name: string, extra: Partial<Row> = {}): Row {
  return {
    id,
    spotify_id: null,
    name,
    name_lower: name.toLowerCase(),
    genres: [],
    popularity: null,
    image_url: null,
    ...extra,
  }
}

/** Fake + a spy on `.from()` / `.in()` so tests can count reads. */
function setup(rows: Row[] = []) {
  const fake = createFakeSupabase({ artists: rows })
  const froms: string[] = []
  const inSizes: number[] = []
  const client: ArtistsClient = {
    from: ((t: string) => {
      froms.push(t)
      const q = fake.client.from(t)
      const origIn = q.in
      q.in = (c: string, v: unknown[]) => {
        inSizes.push(v.length)
        return origIn(c, v)
      }
      return q
    }) as ArtistsClient["from"],
  }
  return { identity: new ArtistIdentity(client), tables: fake.tables, froms, inSizes }
}

/** A client whose every query resolves to `{ error }` (or rejects when `throws`). */
function failingClient(message: string, throws = false): ArtistsClient {
  const settle = () =>
    throws ? Promise.reject(new Error(message)) : Promise.resolve({ data: null, error: { message } })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const q: any = new Proxy(
    {},
    {
      get: (_t, prop) =>
        prop === "then"
          ? (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => settle().then(res, rej)
          : () => q,
    },
  )
  return { from: (() => q) as unknown as ArtistsClient["from"] }
}

function artist(id: string, extra: Partial<Artist> = {}): Artist {
  return { id, name: "X", genres: [], imageUrl: null, popularity: 0, ...extra }
}

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {})
})

describe("batchRead — exact hits", () => {
  it("returns an empty map for empty input", async () => {
    const { identity, froms } = setup()
    expect((await identity.batchRead([])).size).toBe(0)
    expect(froms).toHaveLength(0)
  })

  it("maps a single matching row to an Artist (uuid identity, spotifyId attribute)", async () => {
    const { identity } = setup([
      row(U(1), "Khruangbin", { spotify_id: "sp1", genres: ["psych"], popularity: 61, image_url: "https://i/x.jpg" }),
    ])
    const out = await identity.batchRead(["Khruangbin"])
    expect(out.get("khruangbin")).toEqual({
      id: U(1),
      spotifyId: "sp1",
      name: "Khruangbin",
      genres: ["psych"],
      imageUrl: "https://i/x.jpg",
      popularity: 61,
    })
  })

  it("defaults null genres/popularity to []/0", async () => {
    const { identity } = setup([row(U(1), "A", { genres: null, popularity: null })])
    const a = (await identity.batchRead(["A"])).get("a")!
    expect(a.genres).toEqual([])
    expect(a.popularity).toBe(0)
  })

  it("is case-insensitive on the DB key and returns partial hits for mixed input", async () => {
    const { identity } = setup([row(U(1), "Radiohead")])
    const out = await identity.batchRead(["RADIOHEAD", "Unknown"])
    expect(out.get("radiohead")?.id).toBe(U(1))
    expect(out.has("unknown")).toBe(false)
  })

  it("omits an ambiguous name (>1 row) so the caller runs its lookup", async () => {
    const { identity } = setup([row(U(1), "Phoenix"), row(U(2), "Phoenix")])
    expect((await identity.batchRead(["Phoenix"])).has("phoenix")).toBe(false)
  })

  it("degrades to an empty map on a read error or a throw", async () => {
    expect((await new ArtistIdentity(failingClient("boom")).batchRead(["A"])).size).toBe(0)
    expect((await new ArtistIdentity(failingClient("boom", true)).batchRead(["A"])).size).toBe(0)
  })

  it("chunks .in() lists at 500 so a big batch can't trip URI-too-large", async () => {
    const { identity, inSizes } = setup()
    await identity.batchRead(Array.from({ length: 1201 }, (_, i) => `n${i}`))
    expect(inSizes).toEqual([500, 500, 201])
  })
})

describe("ensure — rule 2: a bare name reuses the one stable row", () => {
  it("mints a name-only row on a miss (no spotify_id; metadata from the seed)", async () => {
    const { identity, tables } = setup()
    const id = await identity.ensure({ name: "Fresh Band", genres: ["indie"], popularity: 40 })
    expect(id).toBeTruthy()
    expect(tables.artists).toHaveLength(1)
    expect(tables.artists[0]).toMatchObject({
      id,
      name: "Fresh Band",
      name_lower: "fresh band",
      genres: ["indie"],
      popularity: 40,
      image_url: null,
    })
    expect(tables.artists[0].spotify_id ?? null).toBeNull()
  })

  it("treats a null spotifyId the same as absent", async () => {
    const { identity, tables } = setup()
    await identity.ensure({ spotifyId: null, name: "Nully" })
    expect(tables.artists).toHaveLength(1)
  })

  it("reuses an existing row by name (case-insensitive) instead of inserting", async () => {
    const { identity, tables } = setup([row(U(7), "Khruangbin")])
    expect(await identity.ensure({ name: "khruangbin" })).toBe(U(7))
    expect(tables.artists).toHaveLength(1)
  })

  it("ambiguous name → deterministic pick: spotify_id NOT NULL first, then popularity desc", async () => {
    const { identity } = setup([
      row(U(1), "Dup", { popularity: 90 }),
      row(U(2), "Dup", { spotify_id: "spA", popularity: 10 }),
      row(U(3), "Dup", { spotify_id: "spB", popularity: 50 }),
    ])
    expect(await identity.ensure({ name: "Dup" })).toBe(U(3))
  })

  it("breaks metadata ties by lowest id regardless of row order (#161)", async () => {
    const a = await setup([row(U(2), "Teethe"), row(U(1), "Teethe"), row(U(3), "Teethe")]).identity.ensure({ name: "Teethe" })
    const b = await setup([row(U(3), "Teethe"), row(U(2), "Teethe"), row(U(1), "Teethe")]).identity.ensure({ name: "Teethe" })
    expect(a).toBe(U(1))
    expect(b).toBe(U(1))
  })

  it("an ambiguous name is read once: ensure() reuses batchRead's rows", async () => {
    const { identity, froms } = setup([row(U(1), "Phoenix"), row(U(2), "Phoenix", { spotify_id: "sp" })])
    await identity.batchRead(["Phoenix"])
    const reads = froms.length
    expect(await identity.ensure({ name: "Phoenix" })).toBe(U(2))
    expect(froms.length).toBe(reads)
  })

  it("returns null (never throws) on a read failure or throw", async () => {
    expect(await new ArtistIdentity(failingClient("down")).ensure({ name: "Boom" })).toBeNull()
    expect(await new ArtistIdentity(failingClient("down", true)).ensure({ name: "Boom" })).toBeNull()
  })

  it("returns null (never throws) on an insert failure", async () => {
    const fake = createFakeSupabase({ artists: [] })
    const client = {
      from: (t: string) => {
        const q = fake.client.from(t)
        q.insert = () => ({ select: () => ({ single: async () => ({ data: null, error: { message: "nope" } }) }) })
        return q
      },
    } as unknown as ArtistsClient
    expect(await new ArtistIdentity(client).ensure({ name: "Boom" })).toBeNull()
  })
})

describe("ensure — rule 1: distinct Spotify ids never share a row", () => {
  it("mints by spotify_id and returns a spotifyId → uuid map", async () => {
    const { identity, tables } = setup()
    const map = await identity.ensureBySpotifyId([
      { spotifyId: "spA", name: "Alpha", genres: ["rock"], popularity: 30, imageUrl: "https://i/a" },
      { spotifyId: "spB", name: "Beta" },
    ])
    expect(map.size).toBe(2)
    expect(tables.artists.find((r) => r.spotify_id === "spA")).toMatchObject({
      id: map.get("spA"),
      name_lower: "alpha",
      genres: ["rock"],
      popularity: 30,
      image_url: "https://i/a",
    })
    expect(tables.artists.find((r) => r.spotify_id === "spB")).toMatchObject({ genres: [], popularity: null, image_url: null })
  })

  it("two same-name artists with different spotifyIds get distinct rows", async () => {
    const { identity, tables } = setup()
    const a = await identity.ensure({ spotifyId: "spPhoenixFR", name: "Phoenix" })
    const b = await identity.ensure({ spotifyId: "spPhoenixUS", name: "Phoenix" })
    expect(a).not.toBe(b)
    expect(tables.artists).toHaveLength(2)
  })

  it("a spotifyId seed never lands on a same-name row holding another spotify_id", async () => {
    const { identity, tables } = setup([row(U(1), "Phoenix", { spotify_id: "spX", popularity: 99 })])
    const id = await identity.ensure({ spotifyId: "spY", name: "Phoenix" })
    expect(id).not.toBe(U(1))
    expect(tables.artists.find((r) => r.id === U(1))?.spotify_id).toBe("spX")
  })

  it("a spotifyId seed doesn't adopt a same-name, spotify-less row either (no merge by name)", async () => {
    const { identity, tables } = setup([row(U(1), "Phoenix")])
    const id = await identity.ensure({ spotifyId: "spY", name: "Phoenix" })
    expect(id).not.toBe(U(1))
    expect(tables.artists.find((r) => r.id === U(1))?.spotify_id).toBeNull()
  })

  it("never clobbers an existing row's metadata and maps to its existing id", async () => {
    const { identity, tables } = setup([row(U(5), "Real Name", { spotify_id: "spA", genres: ["jazz"], popularity: 70 })])
    const map = await identity.ensureBySpotifyId([{ spotifyId: "spA", name: "PLACEHOLDER" }])
    expect(map.get("spA")).toBe(U(5))
    expect(tables.artists[0]).toMatchObject({ name: "Real Name", genres: ["jazz"], popularity: 70 })
  })

  it("dedupes repeated spotifyIds (first-seen wins) and skips seeds without one", async () => {
    const { identity, tables } = setup()
    const map = await identity.ensureBySpotifyId([
      { spotifyId: "spA", name: "First" },
      { spotifyId: "spA", name: "Second" },
      { spotifyId: "", name: "NoId" },
      { name: "Bare" },
    ])
    expect(map.size).toBe(1)
    expect(tables.artists).toHaveLength(1)
    expect(tables.artists[0].name).toBe("First")
  })

  it("race: concurrent mints of the same spotifyId converge on one row", async () => {
    const { identity, tables } = setup()
    const [a, b] = await Promise.all([
      identity.ensure({ spotifyId: "spR", name: "Racer" }),
      new ArtistIdentity(createFakeSupabaseShared(tables)).ensure({ spotifyId: "spR", name: "Racer" }),
    ])
    expect(a).toBe(b)
    expect(tables.artists.filter((r) => r.spotify_id === "spR")).toHaveLength(1)
  })

  it("degrades to an empty map (never throws) on DB failure", async () => {
    expect((await new ArtistIdentity(failingClient("down")).ensureBySpotifyId([{ spotifyId: "spA", name: "A" }])).size).toBe(0)
    expect(await new ArtistIdentity(failingClient("down", true)).ensure({ spotifyId: "spA", name: "A" })).toBeNull()
  })
})

/** A second client over the SAME table map (two processes, one DB). */
function createFakeSupabaseShared(tables: Record<string, Row[]>): ArtistsClient {
  const other = createFakeSupabase()
  other.tables.artists = tables.artists
  return { from: other.client.from }
}

describe("resolve — names in, Map<inputName, Artist> out", () => {
  it("serves an unambiguous name from the table without calling the lookup", async () => {
    const { identity } = setup([row(U(1), "Radiohead", { spotify_id: "sp7" })])
    const lookup = vi.fn()
    const out = await identity.resolve(["RadioHead"], lookup)
    expect(out.get("RadioHead")?.id).toBe(U(1))
    expect(lookup).not.toHaveBeenCalled()
  })

  it("mints on a miss when the lookup confirms the artist", async () => {
    const { identity, tables } = setup()
    const out = await identity.resolve(["New Band"], async (name) => ({ name, genres: ["rock"], popularity: 12 }))
    const a = out.get("New Band")!
    expect(a).toMatchObject({ spotifyId: null, name: "New Band", genres: ["rock"], popularity: 12 })
    expect(tables.artists.map((r) => r.id)).toEqual([a.id])
  })

  it("ambiguous name without evidence → the lookup runs, then the deterministic pick", async () => {
    const { identity, tables } = setup([row(U(1), "Phoenix"), row(U(2), "Phoenix", { spotify_id: "spX" })])
    const lookup = vi.fn(async (name: string) => ({ name }))
    const out = await identity.resolve(["Phoenix"], lookup)
    expect(lookup).toHaveBeenCalledOnce()
    expect(out.get("Phoenix")?.id).toBe(U(2))
    expect(tables.artists).toHaveLength(2)
  })

  it("ambiguous name WITH evidence (spotifyId) → resolves by spotify_id, not the pick", async () => {
    const { identity } = setup([
      row(U(1), "Phoenix", { spotify_id: "spX", popularity: 90 }),
      row(U(2), "Phoenix", { spotify_id: "spY", popularity: 10 }),
    ])
    const out = await identity.resolve(["Phoenix"], async (name) => ({ name, spotifyId: "spY" }))
    expect(out.get("Phoenix")?.id).toBe(U(2))
  })

  it("leaves a name out when the lookup finds nothing or throws", async () => {
    const { identity, tables } = setup()
    const out = await identity.resolve(["Nope", "Boom"], async (name) => {
      if (name === "Boom") throw new Error("getInfo 500")
      return null
    })
    expect(out.size).toBe(0)
    expect(tables.artists).toHaveLength(0)
  })
})

describe("write — fill-only metadata patch", () => {
  it("fills metadata on the uuid row without touching name/name_lower/spotify_id", async () => {
    const { identity, tables } = setup([row(U(1), "Real", { spotify_id: "sp1" })])
    await identity.write("query", artist(U(1), { name: "Other", spotifyId: "spZ", genres: ["dub"], popularity: 44, imageUrl: "https://i/1" }))
    expect(tables.artists[0]).toMatchObject({
      name: "Real",
      name_lower: "real",
      spotify_id: "sp1",
      genres: ["dub"],
      popularity: 44,
      image_url: "https://i/1",
    })
  })

  it("never blanks richer fields: empty genres / zero popularity / null image aren't written", async () => {
    const { identity, tables } = setup([row(U(1), "Rich", { genres: ["jazz"], popularity: 70, image_url: "https://i/r" })])
    await identity.write("Rich", artist(U(1)))
    expect(tables.artists[0]).toMatchObject({ genres: ["jazz"], popularity: 70, image_url: "https://i/r" })
  })

  it("skips an artist without a minted uuid (never inserts)", async () => {
    const { identity, tables, froms } = setup()
    await identity.write("A", artist("not-a-uuid", { spotifyId: "spA", genres: ["x"] }))
    expect(froms).toHaveLength(0)
    expect(tables.artists).toHaveLength(0)
  })

  it("never throws on a write error or throw", async () => {
    await expect(new ArtistIdentity(failingClient("x")).write("A", artist(U(1), { genres: ["g"] }))).resolves.toBeUndefined()
    await expect(new ArtistIdentity(failingClient("x", true)).write("A", artist(U(1), { genres: ["g"] }))).resolves.toBeUndefined()
  })
})
