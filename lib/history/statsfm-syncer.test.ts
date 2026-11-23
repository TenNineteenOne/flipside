import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"

const resolveUnresolvedArtistIds = vi.fn(async (_arg: unknown) => {})
vi.mock("@/lib/history/id-resolver", () => ({
  resolveUnresolvedArtistIds: (arg: unknown) => resolveUnresolvedArtistIds(arg),
}))

let currentSupabase: FakeSupabase["client"]
vi.mock("@/lib/supabase/server", () => ({
  createServiceClient: () => currentSupabase,
}))

import { accumulateStatsFmHistory } from "./statsfm-syncer"
import { createFakeSupabase, type FakeSupabase, type Row, type Tables } from "@/lib/recommendation/__fixtures__/fake-supabase"

const bump = {
  rpcs: {
    // Atomic play_count bump (0041 rpc_bump_listened_play_counts).
    rpc_bump_listened_play_counts: (args: { p_user_id: string; p_ids: string[]; p_now: string }, tables: Tables) => {
      for (const r of tables.listened_artists) {
        if (r.user_id === args.p_user_id && args.p_ids.includes(r.id)) {
          r.play_count += 1
          r.last_seen_at = args.p_now
        }
      }
      return { error: null }
    },
  },
}

/** A fake DB; returns its live tables. */
function makeSupabase(listened: Row[], artists: Row[]): Tables {
  const fake = createFakeSupabase({ listened_artists: listened, artists }, bump)
  currentSupabase = fake.client
  return fake.tables
}

type Item = { name: string; spotifyIds?: string[]; streams?: number | null }

const statsfmResponse = (items: Item[]) => ({
  items: items.map((it, i) => ({
    position: i + 1,
    streams: it.streams,
    artist: { id: i + 1, name: it.name, spotifyIds: it.spotifyIds },
  })),
})

function stubFetch(items: Item[]) {
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
    const { listened_artists: listened, artists } = makeSupabase([], [])
    stubFetch([{ name: "Burial", spotifyIds: ["sp-burial"] }])

    await accumulateStatsFmHistory({ userId: "user-1", statsfmUsername: "u" })

    expect(artists).toHaveLength(1)
    expect(artists[0].spotify_id).toBe("sp-burial")
    expect(listened).toHaveLength(1)
    expect(listened[0].artist_id).toBe(artists[0].id)
    expect(listened[0].source).toBe("statsfm")
    expect(resolveUnresolvedArtistIds).toHaveBeenCalledOnce()
  })

  const existing = () =>
    makeSupabase(
      [
        {
          id: "existing",
          user_id: "user-1",
          artist_id: "artist-uuid-3",
          lastfm_artist_name: null,
          source: "statsfm",
          play_count: 5,
          last_seen_at: "2026-01-01T00:00:00.000Z",
        },
      ],
      [{ id: "artist-uuid-3", spotify_id: "sp-x", name: "X", name_lower: "x" }],
    ).listened_artists

  it("no stream count (null, as stats.fm sends without imported history): +1 per sync, as before", async () => {
    const listened = existing()
    stubFetch([{ name: "X", spotifyIds: ["sp-x"], streams: null }])

    await accumulateStatsFmHistory({ userId: "user-1", statsfmUsername: "u" })

    expect(listened).toHaveLength(1)
    expect(listened[0].play_count).toBe(6)
  })

  it("a stream count is stored as the real play count (#215)", async () => {
    const listened = existing()
    stubFetch([{ name: "X", spotifyIds: ["sp-x"], streams: 321 }, { name: "New", spotifyIds: ["sp-new"], streams: 12 }])

    await accumulateStatsFmHistory({ userId: "user-1", statsfmUsername: "u" })

    expect(listened.map((r) => r.play_count)).toEqual([321, 12])
  })
})

describe("accumulateStatsFmHistory — name-only branch", () => {
  it("inserts name-only rows with artist_id: null", async () => {
    const { listened_artists: listened, artists } = makeSupabase([], [])
    stubFetch([{ name: "Unknown Artist" }]) // no spotifyIds

    await accumulateStatsFmHistory({ userId: "user-1", statsfmUsername: "u" })

    expect(artists).toHaveLength(0) // nothing minted for a name-only row
    expect(listened).toHaveLength(1)
    expect(listened[0].artist_id).toBeNull()
    expect(listened[0].lastfm_artist_name).toBe("Unknown Artist")
    expect("spotify_artist_id" in listened[0]).toBe(false)
  })
})
