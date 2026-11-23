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

  /** A client whose listened_artists inserts answer with `insertError(row)`. */
  function failingInserts(insertError: (row: unknown) => { code?: string; message: string } | null) {
    const { supabase, tables } = setup()
    const client = {
      ...supabase,
      from: (t: string) => {
        const q = supabase.from(t)
        if (t !== "listened_artists") return q
        const insert = q.insert.bind(q)
        q.insert = (row: unknown) => {
          const error = insertError(row)
          return error ? Promise.resolve({ data: null, error }) : insert(row)
        }
        return q
      },
    }
    return { client, tables }
  }

  it("throws when the existing-rows select fails, so the sync is not reported as a success", async () => {
    const fake = createFakeSupabase({ artists: [], listened_artists: [] }, { fail: { listened_artists: "error" } })
    await expect(ingestListens(fake.client, "u1", "lastfm", [{ name: "A" }])).rejects.toThrow("Batch select (names) error")
  })

  it("throws on a batch insert error that is not a unique violation", async () => {
    const { client, tables } = failingInserts(() => ({ code: "57014", message: "timeout" }))
    await expect(ingestListens(client, "u1", "lastfm", [{ name: "A" }])).rejects.toThrow("Batch insert (names) error: timeout")
    expect(tables.listened_artists).toEqual([])
  })

  it("a 23505 on the batch retries per row; a per-row 23505 is skipped, any other error throws", async () => {
    const dup = { code: "23505", message: "duplicate" }
    const skipped = failingInserts((row) => (Array.isArray(row) || (row as Row).lastfm_artist_name === "A" ? dup : null))
    await ingestListens(skipped.client, "u1", "lastfm", [{ name: "A" }, { name: "B" }])
    expect(skipped.tables.listened_artists.map((r) => r.lastfm_artist_name)).toEqual(["B"])

    const broken = failingInserts((row) => (Array.isArray(row) ? dup : { code: "57014", message: "timeout" }))
    await expect(ingestListens(broken.client, "u1", "lastfm", [{ name: "A" }])).rejects.toThrow("Row insert (names) error: timeout")
  })

  describe("real play counts (#215)", () => {
    it("an artist played 500 times is stored as 500 by the first sync that sees them", async () => {
      const { supabase, tables } = setup()
      await ingestListens(supabase, "u1", "lastfm", [{ name: "Radiohead", plays: 500 }, { name: "Radiohead", plays: 3 }, { name: "Once", plays: 1 }])
      await ingestListens(supabase, "u1", "statsfm", [{ name: "Burial", spotifyId: "sp-burial", plays: 42 }])
      expect(tables.listened_artists.map((r) => [r.lastfm_artist_name ?? "Burial", r.play_count])).toEqual([
        ["Radiohead", 500],
        ["Once", 1],
        ["Burial", 42],
      ])
    })

    it("existing rows (old sync counts) are raised to the real count and never lowered", async () => {
      const seen = "2026-01-01T00:00:00.000Z"
      const attempted = new Date().toISOString()
      const { supabase, tables } = setup({
        artists: [{ id: U(3), spotify_id: "sp-x", name: "X", name_lower: "x" }],
        listened_artists: [
          { id: "low", user_id: "u1", artist_id: null, lastfm_artist_name: "Low", source: "lastfm", play_count: 2, last_seen_at: seen, id_resolution_attempted_at: attempted },
          { id: "high", user_id: "u1", artist_id: null, lastfm_artist_name: "High", source: "lastfm", play_count: 900, last_seen_at: seen, id_resolution_attempted_at: attempted },
          { id: "x", user_id: "u1", artist_id: U(3), lastfm_artist_name: null, source: "statsfm", play_count: 1, last_seen_at: seen },
          { id: "other", user_id: "u2", artist_id: null, lastfm_artist_name: "Low", source: "lastfm", play_count: 1, last_seen_at: seen },
        ],
      })
      await ingestListens(supabase, "u1", "lastfm", [{ name: "Low", plays: 500 }, { name: "High", plays: 700 }])
      await ingestListens(supabase, "u1", "statsfm", [{ name: "X", spotifyId: "sp-x", plays: 60 }])
      await ingestListens(supabase, "u1", "lastfm", [{ name: "Low", plays: 500 }]) // a re-sync adds nothing

      const row = (id: string) => tables.listened_artists.find((r) => r.id === id)!
      expect(row("low").play_count).toBe(500)
      expect(row("high").play_count).toBe(900)
      expect(row("x").play_count).toBe(60)
      expect(row("other").play_count).toBe(1) // another user's row is untouched
      expect(row("high").last_seen_at).not.toBe(seen) // still marked as seen by this sync
    })

    it("a source without counts keeps counting sightings, even on a row that holds a real count", async () => {
      const { supabase, tables } = setup({
        listened_artists: [{ id: "a", user_id: "u1", artist_id: null, lastfm_artist_name: "A", source: "lastfm", play_count: 500, id_resolution_attempted_at: new Date().toISOString() }],
      })
      await ingestListens(supabase, "u1", "statsfm", [{ name: "A" }])
      expect(tables.listened_artists[0].play_count).toBe(501)
    })

    it("a 23505 conflict raises the row the other sync just inserted to this source's count", async () => {
      const dup = { code: "23505", message: "duplicate" }
      // The other source's sync inserts "A" between our select and our insert.
      const racing = { id: "racing", user_id: "u1", artist_id: null, lastfm_artist_name: "A", source: "statsfm", play_count: 1, id_resolution_attempted_at: new Date().toISOString() }
      const { client, tables } = failingInserts((row) => {
        if (Array.isArray(row)) tables.listened_artists.push(racing)
        return Array.isArray(row) || (row as Row).lastfm_artist_name === "A" ? dup : null
      })
      await ingestListens(client, "u1", "lastfm", [{ name: "A", plays: 500 }, { name: "B", plays: 9 }])
      expect(tables.listened_artists.map((r) => [r.id === "racing", r.lastfm_artist_name, r.play_count])).toEqual([
        [true, "A", 500],
        [false, "B", 9],
      ])
    })

    it("long lists go out in chunks of at most 200 keys per request (#222)", async () => {
      const fake = createFakeSupabase({ artists: [], listened_artists: [] })
      const listens = Array.from({ length: 450 }, (_, i) => ({ name: `Artist ${i}`, plays: 10 }))
      await ingestListens(fake.client, "u1", "lastfm", listens)
      await ingestListens(fake.client, "u1", "lastfm", listens.map((l) => ({ ...l, plays: 20 })))
      const sizes = fake.queries.filter((q) => q.table === "listened_artists" && q.in).map((q) => q.in!.length)
      expect(Math.max(...sizes)).toBe(200)
      expect(fake.tables.listened_artists.every((r) => r.play_count === 20)).toBe(true)
    })
  })

  it("a failed play_count bump is logged, not thrown", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {})
    const fake = createFakeSupabase({
      artists: [],
      listened_artists: [{ id: "a", user_id: "u1", artist_id: null, lastfm_artist_name: "A", source: "lastfm", play_count: 1, id_resolution_attempted_at: new Date().toISOString() }],
    })
    await expect(ingestListens(fake.client, "u1", "lastfm", [{ name: "A" }])).resolves.toBeUndefined()
    expect(err).toHaveBeenCalledWith("[accumulateLastFmHistory] Batch update (names) error:", "no rpc rpc_bump_listened_play_counts")
  })
})
