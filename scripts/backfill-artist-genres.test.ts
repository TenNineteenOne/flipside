import { describe, it, expect, vi, beforeEach } from "vitest"
import { createFakeSupabase } from "@/lib/recommendation/__fixtures__/fake-supabase"

// Keep the test's checkpoint writes away from a real run's checkpoint file.
vi.hoisted(() => {
  process.env.BACKFILL_CHECKPOINT_PATH = `${process.env.TMPDIR ?? "/tmp"}/backfill-artist-genres.test.checkpoint.json`
})

import { phaseWrite, type Checkpoint } from "./backfill-artist-genres"

const A = "a0000000-0000-4000-8000-000000000001"

function checkpoint(): Checkpoint {
  return {
    schema: 3,
    uniqueArtists: [{ id: A, name: "Artist" }],
    mbResults: { [A]: { mbid: "m", genres: ["shoegaze"], tags: [] } } as unknown as Checkpoint["mbResults"],
    lastfmResults: { [A]: { listeners: 100000, tags: [] } } as unknown as Checkpoint["lastfmResults"],
    writtenIds: [],
    stats: {
      artistsRows: 1, recommendationCacheRows: 2, uniqueIds: 1, mbMatched: 1, mbUnresolved: 0,
      lastfmMatched: 1, lastfmUnresolved: 0, artistsUpdated: 0, recCacheUpdated: 0,
    },
    startedAt: "", lastSavedAt: "",
  }
}

const artistData = (user: string) => ({
  id: A, name: "Artist", genres: [], popularity: 0, imageUrl: `img-${user}`,
  topTracks: [{ id: `t-${user}` }], artist_color: `color-${user}`,
})

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {})
})

describe("backfill-artist-genres phaseWrite (#175)", () => {
  it("--dry-run writes nothing AND checkpoints nothing as written, so the real run still writes", async () => {
    const fake = createFakeSupabase({ artists: [{ id: A, name: "Artist", genres: [], popularity: null }] })
    const cp = checkpoint()
    const artistsById = new Map([[A, { id: A, name: "Artist", genres: [] as string[], popularity: null }]])

    await phaseWrite(cp, fake.client, artistsById, new Map(), true)
    expect(cp.writtenIds).toEqual([])
    expect(fake.tables.artists[0].genres).toEqual([])

    await phaseWrite(cp, fake.client, artistsById, new Map(), false)
    expect(cp.writtenIds).toEqual([A])
    expect(fake.tables.artists[0].genres).toEqual(["shoegaze"])
  })

  it("patches genres/popularity into each user's OWN artist_data (never copies one user's blob onto another's row)", async () => {
    const rows = ["u1", "u2"].map((u) => ({ id: `rc-${u}`, user_id: u, artist_id: A, artist_data: artistData(u) }))
    const fake = createFakeSupabase({ artists: [{ id: A, name: "Artist", genres: [], popularity: null }], recommendation_cache: rows })
    const artistsById = new Map([[A, { id: A, name: "Artist", genres: [] as string[], popularity: null }]])

    const recRows = new Map([[A, rows.map((r) => ({ ...r }))]]) as unknown as Parameters<typeof phaseWrite>[3]
    await phaseWrite(checkpoint(), fake.client, artistsById, recRows, false)

    for (const u of ["u1", "u2"]) {
      const d = fake.tables.recommendation_cache.find((r) => r.user_id === u)!.artist_data
      expect(d.genres).toEqual(["shoegaze"])
      expect(d.popularity).toBeGreaterThan(0)
      expect(d.topTracks).toEqual([{ id: `t-${u}` }])
      expect(d.artist_color).toBe(`color-${u}`)
      expect(d.imageUrl).toBe(`img-${u}`)
    }
  })
})
