import { describe, it, expect, beforeEach, vi } from "vitest"

// The resolve pass confirms names via cached Last.fm getInfo — drive it here.
const artistInfo = vi.fn()
vi.mock("@/lib/lastfm", () => ({
  lastfm: { artistInfo: (...args: unknown[]) => artistInfo(...args) },
}))

import { ingestListens } from "./ingest"
import { createFakeSupabase, type Row, type Tables } from "@/lib/recommendation/__fixtures__/fake-supabase"

const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`

function setup(initial: Tables = {}) {
  const fake = createFakeSupabase(
    { artists: [], listened_artists: [], ...initial },
    {
      rpcs: {
        rpc_bump_listened_play_counts: (args: { p_user_id: string; p_ids: string[]; p_now: string }, tables) => {
          for (const r of tables.listened_artists) {
            if (r.user_id === args.p_user_id && args.p_ids.includes(r.id)) {
              r.play_count += 1
              r.last_seen_at = args.p_now
            }
          }
          return { error: null }
        },
      },
    },
  )
  return { supabase: fake.client, tables: fake.tables }
}

/** The listened_artists columns a source writes, minus generated ids/timestamps. */
const shape = (r: Row) => ({
  user_id: r.user_id,
  artist_id: r.artist_id,
  lastfm_artist_name: r.lastfm_artist_name,
  source: r.source,
  play_count: r.play_count,
})

beforeEach(() => {
  artistInfo.mockReset()
  artistInfo.mockResolvedValue(null) // names stay unresolved unless a test says otherwise
  vi.spyOn(console, "log").mockImplementation(() => {})
})

describe("ingestListens — listens in → listened_artists rows out", () => {
  it("spotifyId listens mint artists by spotify_id and insert artist_id rows; bare names insert name-only rows", async () => {
    const { supabase, tables } = setup()
    await ingestListens(supabase, "u1", "statsfm", [
      { name: "Burial", spotifyId: "sp-burial" },
      { name: "Burial", spotifyId: "sp-burial" },
      { name: "Unknown Artist" },
      { name: "Unknown Artist" },
    ])

    expect(tables.artists).toHaveLength(1)
    expect(tables.artists[0]).toMatchObject({ spotify_id: "sp-burial", name: "Burial", name_lower: "burial" })
    expect(tables.listened_artists.map(shape)).toEqual([
      { user_id: "u1", artist_id: tables.artists[0].id, lastfm_artist_name: null, source: "statsfm", play_count: 1 },
      { user_id: "u1", artist_id: null, lastfm_artist_name: "Unknown Artist", source: "statsfm", play_count: 1 },
    ])
    expect(tables.listened_artists[1].id_resolution_attempted_at).toBeTruthy() // resolve pass ran
  })

  it("bumps play_count on existing rows instead of inserting duplicates", async () => {
    const { supabase, tables } = setup({
      artists: [{ id: U(3), spotify_id: "sp-x", name: "X", name_lower: "x" }],
      listened_artists: [
        { id: "a", user_id: "u1", artist_id: U(3), lastfm_artist_name: null, source: "statsfm", play_count: 5, last_seen_at: "2026-01-01T00:00:00.000Z" },
        { id: "b", user_id: "u1", artist_id: null, lastfm_artist_name: "Aphex Twin", source: "lastfm", play_count: 7, last_seen_at: "2026-01-01T00:00:00.000Z", id_resolution_attempted_at: new Date().toISOString() },
      ],
    })
    await ingestListens(supabase, "u1", "lastfm", [{ name: "Aphex Twin" }, { name: "Boards of Canada" }])
    await ingestListens(supabase, "u1", "statsfm", [{ name: "X", spotifyId: "sp-x" }])

    expect(tables.listened_artists.map(shape)).toEqual([
      { user_id: "u1", artist_id: U(3), lastfm_artist_name: null, source: "statsfm", play_count: 6 },
      { user_id: "u1", artist_id: null, lastfm_artist_name: "Aphex Twin", source: "lastfm", play_count: 8 },
      { user_id: "u1", artist_id: null, lastfm_artist_name: "Boards of Canada", source: "lastfm", play_count: 1 },
    ])
    expect(tables.artists).toHaveLength(1) // sp-x already known — no new row
  })

  it("the resolve pass turns a confirmed name-only row into an artist_id row", async () => {
    const { supabase, tables } = setup({ artists: [{ id: U(9), spotify_id: null, name: "Radiohead", name_lower: "radiohead" }] })
    await ingestListens(supabase, "u1", "lastfm", [{ name: "Radiohead" }, { name: "New Band" }])

    // Radiohead: unambiguous table hit. New Band: getInfo was null on this run.
    expect(tables.listened_artists.map(shape)).toEqual([
      { user_id: "u1", artist_id: U(9), lastfm_artist_name: "Radiohead", source: "lastfm", play_count: 1 },
      { user_id: "u1", artist_id: null, lastfm_artist_name: "New Band", source: "lastfm", play_count: 1 },
    ])
  })

  it("a resolve-pass failure is logged, never thrown", async () => {
    const { supabase } = setup()
    const err = vi.spyOn(console, "error").mockImplementation(() => {})
    const broken = {
      ...supabase,
      from: (t: string) => {
        const q = supabase.from(t)
        if (t === "listened_artists") q.or = () => { throw new Error("db down") }
        return q
      },
    }
    await expect(ingestListens(broken, "u1", "lastfm", [{ name: "A" }])).resolves.toBeUndefined()
    expect(err).toHaveBeenCalledWith("[accumulateLastFmHistory] Resolution pass failed:", "db down")
  })
})
