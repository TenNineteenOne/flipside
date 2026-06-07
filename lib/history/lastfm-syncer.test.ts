import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"

// Stub the resolution pass — covered by id-resolver.test.ts.
const resolveUnresolvedArtistIds = vi.fn(async (_arg: unknown) => {})
vi.mock("@/lib/history/id-resolver", () => ({
  resolveUnresolvedArtistIds: (arg: unknown) => resolveUnresolvedArtistIds(arg),
}))

let currentSupabase: ReturnType<typeof makeSupabase>
vi.mock("@/lib/supabase/server", () => ({
  createServiceClient: () => currentSupabase,
}))

import { accumulateLastFmHistory } from "./lastfm-syncer"

interface ListenedRow {
  id: string
  user_id: string
  artist_id: string | null
  lastfm_artist_name: string | null
  source: string
  play_count: number
  last_seen_at: string
}

function makeSupabase(listened: ListenedRow[]) {
  let seq = 0
  return {
    from() {
      return {
        select() {
          return {
            _userId: undefined as string | undefined,
            eq(col: string, val: string) {
              if (col === "user_id") this._userId = val
              return this
            },
            in(_col: string, values: string[]) {
              const data = listened.filter(
                (r) => r.user_id === this._userId && r.lastfm_artist_name != null && values.includes(r.lastfm_artist_name)
              )
              return Promise.resolve({
                data: data.map((r) => ({ id: r.id, lastfm_artist_name: r.lastfm_artist_name, play_count: r.play_count })),
                error: null,
              })
            },
          }
        },
        async insert(rows: Omit<ListenedRow, "id">[] | Omit<ListenedRow, "id">) {
          const arr = Array.isArray(rows) ? rows : [rows]
          for (const r of arr) listened.push({ id: `row-${++seq}`, ...r })
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
    },
  }
}

const lastfmResponse = (names: string[]) => ({
  topartists: { artist: names.map((name) => ({ name, playcount: "5" })) },
})

beforeEach(() => {
  resolveUnresolvedArtistIds.mockClear()
  process.env.LASTFM_API_KEY = "test-key"
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const body = url.includes("getTopArtists")
        ? lastfmResponse(["Aphex Twin", "Boards of Canada"])
        : { recenttracks: { track: [] } }
      return new Response(JSON.stringify(body), { status: 200 })
    })
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("accumulateLastFmHistory", () => {
  it("inserts name-only rows with artist_id: null (no spotify_artist_id)", async () => {
    const listened: ListenedRow[] = []
    currentSupabase = makeSupabase(listened)

    await accumulateLastFmHistory({ userId: "user-1", lastfmUsername: "u", accessToken: "tok" })

    expect(listened).toHaveLength(2)
    for (const row of listened) {
      expect(row.artist_id).toBeNull()
      expect(row.lastfm_artist_name).toBeTruthy()
      expect(row.source).toBe("lastfm")
      // the legacy column must not be set by the name-only path
      expect("spotify_artist_id" in row).toBe(false)
    }
    expect(resolveUnresolvedArtistIds).toHaveBeenCalledOnce()
  })

  it("increments play_count for an existing name row", async () => {
    const listened: ListenedRow[] = [
      {
        id: "existing",
        user_id: "user-1",
        artist_id: null,
        lastfm_artist_name: "Aphex Twin",
        source: "lastfm",
        play_count: 7,
        last_seen_at: "2026-01-01T00:00:00.000Z",
      },
    ]
    currentSupabase = makeSupabase(listened)

    await accumulateLastFmHistory({ userId: "user-1", lastfmUsername: "u", accessToken: "tok" })

    const aphex = listened.find((r) => r.lastfm_artist_name === "Aphex Twin")!
    expect(aphex.play_count).toBe(8)
    // Boards of Canada newly inserted
    expect(listened.find((r) => r.lastfm_artist_name === "Boards of Canada")).toBeTruthy()
  })
})
