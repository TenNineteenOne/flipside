/**
 * PreviewStore — the sole owner of `artist_tracks_cache` (#175 D1). One suite
 * for every read/write path, on the in-memory fake Supabase. Folds in the old
 * persist-confirms.test.ts collector cases and the engine rehydrate tests.
 */
import { describe, it, expect, vi, afterEach } from "vitest"
import { createFakeSupabase, type Row } from "./__fixtures__/fake-supabase"
import { PreviewStore, PREVIEW_TTL_MS, resetPersisted, snapshotPersisted } from "./preview-store"
import type { ConfirmOutcome } from "./confirm-previews"
import type { Artist, Track } from "@/lib/music-provider/types"

const UUID_A = "aaaaaaaa-0000-4000-8000-000000000001"
const UUID_B = "bbbbbbbb-0000-4000-8000-000000000002"

function track(id: string): Track {
  return {
    id,
    spotifyTrackId: null,
    name: `Track ${id}`,
    previewUrl: `https://audio.example.com/${id}.m4a`,
    durationMs: 30000,
    albumName: "Album",
    albumImageUrl: null,
    source: "itunes",
  }
}

const iso = (msAgo: number) => new Date(Date.now() - msAgo).toISOString()
const HOUR = 60 * 60 * 1000

function cacheRow(artist_id: string, tracks: Track[], fetched_at: string | null = iso(0)): Row {
  return { artist_id, tracks, source: tracks.length ? "itunes" : "none", fetched_at }
}

function cand(id: string, name = `Artist ${id}`): { artist: Artist } {
  return { artist: { id, name, genres: [], imageUrl: null, popularity: 0 } }
}

function positive(artistId: string, name = "Artist"): ConfirmOutcome {
  return { artistId, name, tracks: [track("t1")], definitiveEmpty: false, source: "itunes" }
}
function negative(artistId: string, name = "Artist"): ConfirmOutcome {
  return { artistId, name, tracks: [], definitiveEmpty: true, source: "itunes" }
}

afterEach(() => vi.restoreAllMocks())

// ── read-for-confirm ─────────────────────────────────────────────────────────
describe("PreviewStore.rehydrate", () => {
  it("positive row → topTracks; fresh negative → knownEmpty; no row → untouched", async () => {
    const fake = createFakeSupabase({
      artist_tracks_cache: [cacheRow(UUID_A, [track("p")]), cacheRow(UUID_B, [])],
    })
    const cands = [cand(UUID_A), cand(UUID_B), cand("cold")]
    await new PreviewStore(fake.client).rehydrate(cands)

    expect(cands[0].artist.topTracks).toHaveLength(1)
    expect(cands[0].artist.knownEmpty).toBeUndefined()
    expect(cands[1].artist.topTracks).toBeUndefined()
    expect(cands[1].artist.knownEmpty).toBe(true)
    expect(cands[2].artist.topTracks).toBeUndefined()
    expect(cands[2].artist.knownEmpty).toBeUndefined()
  })

  it("positives have no TTL: a 30-day-old positive is still reused", async () => {
    const fake = createFakeSupabase({ artist_tracks_cache: [cacheRow(UUID_A, [track("p")], iso(30 * 24 * HOUR))] })
    const cands = [cand(UUID_A)]
    await new PreviewStore(fake.client).rehydrate(cands)
    expect(cands[0].artist.topTracks).toHaveLength(1)
  })

  it("expired negative (25h > 24h TTL) → ignored, artist re-confirms", async () => {
    const fake = createFakeSupabase({ artist_tracks_cache: [cacheRow(UUID_B, [], iso(25 * HOUR))] })
    const cands = [cand(UUID_B)]
    await new PreviewStore(fake.client).rehydrate(cands)
    expect(cands[0].artist.knownEmpty).toBeUndefined()
    expect(cands[0].artist.topTracks).toBeUndefined()
  })

  it("negative with no fetched_at → not honored (unknown age)", async () => {
    const fake = createFakeSupabase({ artist_tracks_cache: [cacheRow(UUID_B, [], null)] })
    const cands = [cand(UUID_B)]
    await new PreviewStore(fake.client).rehydrate(cands)
    expect(cands[0].artist.knownEmpty).toBeUndefined()
    expect(cands[0].artist.topTracks).toBeUndefined()
  })

  it("degrades to no rehydration on read error (never throws)", async () => {
    const fake = createFakeSupabase({}, { fail: { artist_tracks_cache: "error" } })
    const cands = [cand(UUID_A)]
    await expect(new PreviewStore(fake.client).rehydrate(cands)).resolves.toBeUndefined()
    expect(cands[0].artist.topTracks).toBeUndefined()
  })

  it("no-ops on an empty candidate list (no query)", async () => {
    const fake = createFakeSupabase()
    await new PreviewStore(fake.client).rehydrate([])
    expect(fake.queries).toHaveLength(0)
  })

  it("dedupes ids into one artist_tracks_cache read", async () => {
    const fake = createFakeSupabase()
    await new PreviewStore(fake.client).rehydrate([cand("dup"), cand("dup"), cand("other")])
    expect(fake.queries).toEqual([{ table: "artist_tracks_cache", op: "select", in: ["dup", "other"] }])
  })
})

// ── read-for-display ─────────────────────────────────────────────────────────
describe("PreviewStore.readForDisplay", () => {
  it("returns stored tracks per id regardless of age; no row → absent", async () => {
    const fake = createFakeSupabase({
      artist_tracks_cache: [cacheRow(UUID_A, [track("p")], iso(90 * 24 * HOUR)), cacheRow(UUID_B, [])],
    })
    const out = await new PreviewStore(fake.client).readForDisplay([UUID_A, UUID_B, "nope"])
    expect(out.get(UUID_A)).toHaveLength(1)
    expect(out.get(UUID_B)).toEqual([])
    expect(out.has("nope")).toBe(false)
  })
})

// ── record outcomes (collector) ──────────────────────────────────────────────
describe("PreviewStore.collector", () => {
  const rows = (fake: ReturnType<typeof createFakeSupabase>) => fake.tables.artist_tracks_cache ?? []

  it("no-op when nothing collected (no query at all)", async () => {
    const fake = createFakeSupabase()
    await new PreviewStore(fake.client).collector().flush()
    expect(fake.queries).toHaveLength(0)
  })

  it("persists a positive as source=itunes with tracks + fetched_at", async () => {
    resetPersisted()
    const fake = createFakeSupabase()
    const c = new PreviewStore(fake.client).collector()
    c.onConfirmOutcome(positive(UUID_A))
    await c.flush()
    expect(rows(fake)).toHaveLength(1)
    expect(rows(fake)[0]).toMatchObject({ artist_id: UUID_A, source: "itunes" })
    expect(rows(fake)[0].tracks).toHaveLength(1)
    expect(typeof rows(fake)[0].fetched_at).toBe("string")
    expect(rows(fake)[0].name).toBeUndefined() // the guard's name never lands in the table
    expect(snapshotPersisted()).toBe(1)
  })

  it("persists a negative as source=none with empty tracks", async () => {
    const fake = createFakeSupabase()
    const c = new PreviewStore(fake.client).collector()
    c.onConfirmOutcome(negative(UUID_A))
    await c.flush()
    expect(rows(fake)[0]).toMatchObject({ artist_id: UUID_A, source: "none", tracks: [] })
  })

  it("skips non-uuid artistIds", async () => {
    const fake = createFakeSupabase()
    const c = new PreviewStore(fake.client).collector()
    c.onConfirmOutcome(positive("not-a-uuid"))
    c.onConfirmOutcome(positive(UUID_A))
    await c.flush()
    expect(rows(fake).map((r) => r.artist_id)).toEqual([UUID_A])
  })

  it("dedupes by artistId — last write wins", async () => {
    const fake = createFakeSupabase()
    const c = new PreviewStore(fake.client).collector()
    c.onConfirmOutcome(positive(UUID_A))
    c.onConfirmOutcome(negative(UUID_A))
    c.onConfirmOutcome(positive(UUID_B))
    await c.flush()
    expect(rows(fake)).toHaveLength(2)
    expect(rows(fake).find((r) => r.artist_id === UUID_A)?.source).toBe("none")
    expect(rows(fake).find((r) => r.artist_id === UUID_B)?.source).toBe("itunes")
  })

  it("swallows an upsert error and a thrown upsert (never throws)", async () => {
    for (const mode of ["error", "throw"] as const) {
      const fake = createFakeSupabase({}, { fail: { artist_tracks_cache: mode } })
      const c = new PreviewStore(fake.client).collector()
      c.onConfirmOutcome(positive(UUID_A))
      await expect(c.flush()).resolves.toBeUndefined()
    }
  })

  it("flush is one upsert: no canonical artists read (the guard holds by construction, #175 E4a)", async () => {
    const fake = createFakeSupabase({ artists: [{ id: UUID_A, name: "Artist" }] })
    const c = new PreviewStore(fake.client).collector()
    c.onConfirmOutcome(positive(UUID_A))
    c.onConfirmOutcome(negative(UUID_B))
    await c.flush()
    expect(fake.queries.map((q) => q.table)).toEqual(["artist_tracks_cache"])
    expect(rows(fake)).toHaveLength(2)
  })
})

// The failure-never-writes-a-negative rule lives in confirmPlayableTracks (no
// outcome is emitted on an iTunes failure); end-to-end it is covered by
// playable-candidates.test.ts. This pins the store's half: only what is
// recorded is written.
describe("PreviewStore — failure never writes a negative", () => {
  it("an artist with no recorded outcome gets no row", async () => {
    const fake = createFakeSupabase()
    const c = new PreviewStore(fake.client).collector()
    c.onConfirmOutcome(positive(UUID_A))
    await c.flush()
    expect((fake.tables.artist_tracks_cache ?? []).find((r) => r.artist_id === UUID_B)).toBeUndefined()
  })
})

// ── tracks route path ────────────────────────────────────────────────────────
describe("PreviewStore.serveTracks", () => {
  const live = [track("live")]

  it("fresh positive → cached tracks, no live call", async () => {
    const fake = createFakeSupabase({ artist_tracks_cache: [cacheRow(UUID_A, [track("c")], iso(HOUR))] })
    const search = vi.fn()
    const out = await new PreviewStore(fake.client).serveTracks(UUID_A, "X", search)
    expect(out).toEqual({ tracks: [track("c")] })
    expect(search).not.toHaveBeenCalled()
  })

  it("fresh negative → [] (not a cache miss), no live call", async () => {
    const fake = createFakeSupabase({ artist_tracks_cache: [cacheRow(UUID_A, [], iso(HOUR))] })
    const search = vi.fn()
    expect(await new PreviewStore(fake.client).serveTracks(UUID_A, "X", search)).toEqual({ tracks: [] })
    expect(search).not.toHaveBeenCalled()
  })

  it("stale positive (> TTL) refreshes from iTunes and writes back", async () => {
    const fake = createFakeSupabase({
      artist_tracks_cache: [cacheRow(UUID_A, [track("old")], iso(PREVIEW_TTL_MS + HOUR))],
      artists: [{ id: UUID_A, name: "X" }],
    })
    const out = await new PreviewStore(fake.client).serveTracks(UUID_A, "X", async () => live)
    expect(out).toEqual({ tracks: live })
    expect(fake.tables.artist_tracks_cache[0].tracks).toEqual(live)
    expect(fake.tables.artist_tracks_cache[0].source).toBe("itunes")
  })

  it("#175 F-H: stale positive + iTunes failure / empty → the stored tracks, row not rewritten", async () => {
    const fetched = iso(PREVIEW_TTL_MS + HOUR)
    const fake = createFakeSupabase({ artist_tracks_cache: [cacheRow(UUID_A, [track("old")], fetched)] })
    vi.spyOn(console, "error").mockImplementation(() => {})
    const store = new PreviewStore(fake.client)
    expect(await store.serveTracks(UUID_A, "X", async () => null)).toEqual({ tracks: [track("old")] })
    expect(await store.serveTracks(UUID_A, "X", async () => { throw new Error("down") })).toEqual({ tracks: [track("old")] })
    expect(await store.serveTracks(UUID_A, "X", async () => [])).toEqual({ tracks: [track("old")] })
    expect(fake.tables.artist_tracks_cache[0].fetched_at).toBe(fetched)
    // A stale NEGATIVE is still a cache miss.
    const neg = createFakeSupabase({ artist_tracks_cache: [cacheRow(UUID_A, [], fetched)] })
    expect(await new PreviewStore(neg.client).serveTracks(UUID_A, "X", async () => null)).toEqual({ tracks: [], cacheMiss: true })
  })

  it("no row + live result → written; no row + empty live → cache miss, nothing written", async () => {
    const fake = createFakeSupabase()
    expect(await new PreviewStore(fake.client).serveTracks(UUID_A, "X", async () => live)).toEqual({ tracks: live })
    expect(fake.tables.artist_tracks_cache).toHaveLength(1)
    expect(await new PreviewStore(fake.client).serveTracks(UUID_B, "Y", async () => [])).toEqual({ tracks: [], cacheMiss: true })
    expect(fake.tables.artist_tracks_cache).toHaveLength(1)
  })

  it("no row and no name → cache miss without a live call", async () => {
    const fake = createFakeSupabase()
    const search = vi.fn()
    expect(await new PreviewStore(fake.client).serveTracks(UUID_A, null, search)).toEqual({ tracks: [], cacheMiss: true })
    expect(search).not.toHaveBeenCalled()
  })

  it("poison guard: serves live tracks to the caller but skips the shared write on a name mismatch", async () => {
    const fake = createFakeSupabase({ artists: [{ id: UUID_A, name: "Real Name" }] })
    vi.spyOn(console, "warn").mockImplementation(() => {})
    const out = await new PreviewStore(fake.client).serveTracks(UUID_A, "Imposter", async () => live)
    expect(out).toEqual({ tracks: live })
    expect(fake.tables.artist_tracks_cache ?? []).toHaveLength(0)
  })

  it("DB read error → null; a throwing live search → cache miss", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {})
    const bad = createFakeSupabase({}, { fail: { artist_tracks_cache: "error" } })
    expect(await new PreviewStore(bad.client).serveTracks(UUID_A, "X", async () => live)).toBeNull()
    const fake = createFakeSupabase()
    const out = await new PreviewStore(fake.client).serveTracks(UUID_A, "X", async () => { throw new Error("down") })
    expect(out).toEqual({ tracks: [], cacheMiss: true })
  })
})
