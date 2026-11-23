import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"

// Stub the resolution pass — covered by id-resolver.test.ts.
const resolveUnresolvedArtistIds = vi.fn(async (_arg: unknown) => {})
vi.mock("@/lib/history/id-resolver", () => ({
  resolveUnresolvedArtistIds: (arg: unknown) => resolveUnresolvedArtistIds(arg),
}))

let currentSupabase: FakeSupabase["client"]
vi.mock("@/lib/supabase/server", () => ({
  createServiceClient: () => currentSupabase,
}))

import { accumulateLastFmHistory } from "./lastfm-syncer"
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

/** A fake DB holding `listened`; returns the live listened_artists rows. */
function makeSupabase(listened: Row[]): Row[] {
  const fake = createFakeSupabase({ listened_artists: listened }, bump)
  currentSupabase = fake.client
  return fake.tables.listened_artists
}

const lastfmResponse = (names: string[]) => ({
  topartists: { artist: names.map((name) => ({ name, playcount: "500" })) },
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
    const listened = makeSupabase([])

    await accumulateLastFmHistory({ userId: "user-1", lastfmUsername: "u" })

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

  it("stores Last.fm's real play count: on insert, and on an existing row that held a sync count (#215)", async () => {
    const listened = makeSupabase([
      {
        id: "existing",
        user_id: "user-1",
        artist_id: null,
        lastfm_artist_name: "Aphex Twin",
        source: "lastfm",
        play_count: 1,
        last_seen_at: "2026-01-01T00:00:00.000Z",
      },
    ])

    await accumulateLastFmHistory({ userId: "user-1", lastfmUsername: "u" })

    expect(listened.map((r) => [r.lastfm_artist_name, r.play_count])).toEqual([
      ["Aphex Twin", 500],
      ["Boards of Canada", 500],
    ])
  })
})
