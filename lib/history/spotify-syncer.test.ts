import { describe, it, expect, beforeEach, vi } from "vitest"

// ── Mock the music provider singleton ────────────────────────────────────────
const getTopArtists = vi.fn()
const getRecentlyPlayed = vi.fn()
vi.mock("@/lib/music-provider/provider", () => ({
  musicProvider: {
    getTopArtists: (...args: unknown[]) => getTopArtists(...args),
    getRecentlyPlayed: (...args: unknown[]) => getRecentlyPlayed(...args),
  },
}))

// ── Mock the service client ──────────────────────────────────────────────────
let currentSupabase: ReturnType<typeof makeSupabase>
vi.mock("@/lib/supabase/server", () => ({
  createServiceClient: () => currentSupabase,
}))

import { accumulateSpotifyHistory } from "./spotify-syncer"

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
            const data = listened.filter(
              (r) => r.user_id === this._userId && r.artist_id != null && values.includes(r.artist_id)
            )
            return Promise.resolve({
              data: data.map((r) => ({ id: r.id, artist_id: r.artist_id, play_count: r.play_count })),
              error: null,
            })
          },
        }
      },
      async insert(rows: Omit<ListenedRow, "id">[]) {
        for (const r of rows) listened.push({ id: `listened-${++listenedSeq}`, ...r })
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

beforeEach(() => {
  getTopArtists.mockReset()
  getRecentlyPlayed.mockReset()
})

describe("accumulateSpotifyHistory", () => {
  it("mints uuids for top artists and inserts listened_artists by artist_id", async () => {
    const listened: ListenedRow[] = []
    const artists: ArtistRow[] = []
    currentSupabase = makeSupabase(listened, artists)

    getTopArtists.mockImplementation(async (_tok: string, term: string) =>
      term === "short_term"
        ? [{ id: "sp-1", name: "Alpha", genres: [], popularity: 50, imageUrl: null }]
        : []
    )
    getRecentlyPlayed.mockResolvedValue([])

    await accumulateSpotifyHistory({ userId: "user-1", accessToken: "tok" })

    expect(artists).toHaveLength(1)
    expect(artists[0].spotify_id).toBe("sp-1")
    expect(listened).toHaveLength(1)
    expect(listened[0].artist_id).toBe("artist-uuid-1")
    expect(listened[0].lastfm_artist_name).toBeNull()
    expect(listened[0].source).toBe("spotify_top")
  })

  it("uses the recent play name, and increments play_count for an existing row", async () => {
    const artists: ArtistRow[] = [
      { id: "artist-uuid-9", spotify_id: "sp-9", name: "Recent Artist", name_lower: "recent artist" },
    ]
    const listened: ListenedRow[] = [
      {
        id: "row-existing",
        user_id: "user-1",
        artist_id: "artist-uuid-9",
        lastfm_artist_name: null,
        source: "spotify_recent",
        play_count: 2,
        last_seen_at: "2026-01-01T00:00:00.000Z",
      },
    ]
    currentSupabase = makeSupabase(listened, artists)

    getTopArtists.mockResolvedValue([])
    getRecentlyPlayed.mockResolvedValue([
      { artistId: "sp-9", artistName: "Recent Artist", playedAt: "2026-03-01T00:00:00.000Z" },
    ])

    await accumulateSpotifyHistory({ userId: "user-1", accessToken: "tok" })

    expect(listened).toHaveLength(1)
    expect(listened[0].play_count).toBe(3)
  })

  it("falls back to the spotify id as a placeholder name when a recent play has no name", async () => {
    const listened: ListenedRow[] = []
    const artists: ArtistRow[] = []
    currentSupabase = makeSupabase(listened, artists)

    getTopArtists.mockResolvedValue([])
    getRecentlyPlayed.mockResolvedValue([
      { artistId: "sp-noname", artistName: "", playedAt: "2026-03-01T00:00:00.000Z" },
    ])

    await accumulateSpotifyHistory({ userId: "user-1", accessToken: "tok" })

    expect(artists).toHaveLength(1)
    expect(artists[0].name).toBe("sp-noname")
    expect(listened[0].artist_id).toBe("artist-uuid-1")
  })
})
