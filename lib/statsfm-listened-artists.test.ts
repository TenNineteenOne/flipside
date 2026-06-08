import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"

const resolveUnresolvedArtistIds = vi.fn(async (_arg: unknown) => {})
vi.mock("@/lib/history/id-resolver", () => ({
  resolveUnresolvedArtistIds: (arg: unknown) => resolveUnresolvedArtistIds(arg),
}))

let currentSupabase: ReturnType<typeof makeSupabase>
vi.mock("@/lib/supabase/server", () => ({
  createServiceClient: () => currentSupabase,
}))

import { accumulateStatsFmHistory } from "./statsfm-listened-artists"

interface ListenedRow {
  id: string
  user_id: string
  artist_id: string | null
  lastfm_artist_name: string | null
  source: string
  play_count: number
  last_seen_at: string
}

interface ArtistRow {
  id: string
  spotify_id: string | null
  name: string
  name_lower: string
}

function makeSupabase(listened: ListenedRow[], artists: ArtistRow[]) {
  let artistSeq = 0
  let listenedSeq = 0

  function artistsTable() {
    return {
      async upsert(rows: ArtistRow[]) {
        for (const r of rows) {
          if (artists.find((x) => x.spotify_id === r.spotify_id)) continue
          artists.push({ ...r, id: `artist-uuid-${++artistSeq}` })
        }
        return { error: null }
      },
      select() {
        return {
          async in(column: string, values: string[]) {
            const data = artists
              .filter((x) => values.includes((x as unknown as Record<string, unknown>)[column] as string))
              .map((x) => ({ id: x.id, spotify_id: x.spotify_id }))
            return { data, error: null }
          },
        }
      },
    }
  }

  function listenedTable() {
    return {
      select() {
        return {
          _userId: undefined as string | undefined,
          eq(col: string, val: string) {
            if (col === "user_id") this._userId = val
            return this
          },
          in(col: string, values: string[]) {
            const data = listened.filter((r) => {
              if (r.user_id !== this._userId) return false
              if (col === "artist_id") return r.artist_id != null && values.includes(r.artist_id)
              if (col === "lastfm_artist_name")
                return r.lastfm_artist_name != null && values.includes(r.lastfm_artist_name)
              return false
            })
            return Promise.resolve({
              data: data.map((r) => ({
                id: r.id,
                artist_id: r.artist_id,
                lastfm_artist_name: r.lastfm_artist_name,
                play_count: r.play_count,
              })),
              error: null,
            })
          },
        }
      },
      async insert(rows: Omit<ListenedRow, "id">[] | Omit<ListenedRow, "id">) {
        const arr = Array.isArray(rows) ? rows : [rows]
        for (const r of arr) listened.push({ id: `row-${++listenedSeq}`, ...r })
        return { error: null }
      },
      async upsert(rows: Array<{ id: string; play_count: number; last_seen_at: string }>) {
        for (const r of rows) {
          const target = listened.find((x) => x.id === r.id)
          if (target) Object.assign(target, { play_count: r.play_count, last_seen_at: r.last_seen_at })
        }
        return { error: null }
      },
    }
  }

  return {
    from(table: string) {
      if (table === "artists") return artistsTable()
      if (table === "listened_artists") return listenedTable()
      throw new Error(`unexpected table ${table}`)
    },
  }
}

const statsfmResponse = (items: Array<{ name: string; spotifyIds?: string[] }>) => ({
  items: items.map((it, i) => ({
    position: i + 1,
    artist: { id: i + 1, name: it.name, spotifyIds: it.spotifyIds },
  })),
})

function stubFetch(items: Array<{ name: string; spotifyIds?: string[] }>) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify(statsfmResponse(items)), { status: 200 }))
  )
}

beforeEach(() => {
  resolveUnresolvedArtistIds.mockClear()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("accumulateStatsFmHistory — resolved (spotify-id) branch", () => {
  it("mints uuids and inserts by artist_id", async () => {
    const listened: ListenedRow[] = []
    const artists: ArtistRow[] = []
    currentSupabase = makeSupabase(listened, artists)
    stubFetch([{ name: "Burial", spotifyIds: ["sp-burial"] }])

    await accumulateStatsFmHistory({ userId: "user-1", statsfmUsername: "u" })

    expect(artists).toHaveLength(1)
    expect(artists[0].spotify_id).toBe("sp-burial")
    expect(listened).toHaveLength(1)
    expect(listened[0].artist_id).toBe("artist-uuid-1")
    expect(listened[0].source).toBe("statsfm")
    expect(resolveUnresolvedArtistIds).toHaveBeenCalledOnce()
  })

  it("increments play_count for an existing artist_id row", async () => {
    const artists: ArtistRow[] = [
      { id: "artist-uuid-3", spotify_id: "sp-x", name: "X", name_lower: "x" },
    ]
    const listened: ListenedRow[] = [
      {
        id: "existing",
        user_id: "user-1",
        artist_id: "artist-uuid-3",
        lastfm_artist_name: null,
        source: "statsfm",
        play_count: 5,
        last_seen_at: "2026-01-01T00:00:00.000Z",
      },
    ]
    currentSupabase = makeSupabase(listened, artists)
    stubFetch([{ name: "X", spotifyIds: ["sp-x"] }])

    await accumulateStatsFmHistory({ userId: "user-1", statsfmUsername: "u" })

    expect(listened).toHaveLength(1)
    expect(listened[0].play_count).toBe(6)
  })
})

describe("accumulateStatsFmHistory — name-only branch", () => {
  it("inserts name-only rows with artist_id: null", async () => {
    const listened: ListenedRow[] = []
    const artists: ArtistRow[] = []
    currentSupabase = makeSupabase(listened, artists)
    stubFetch([{ name: "Unknown Artist" }]) // no spotifyIds

    await accumulateStatsFmHistory({ userId: "user-1", statsfmUsername: "u" })

    expect(artists).toHaveLength(0) // nothing minted for a name-only row
    expect(listened).toHaveLength(1)
    expect(listened[0].artist_id).toBeNull()
    expect(listened[0].lastfm_artist_name).toBe("Unknown Artist")
    expect("spotify_artist_id" in listened[0]).toBe(false)
  })
})
