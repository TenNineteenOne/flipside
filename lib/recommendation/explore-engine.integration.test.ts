/**
 * Integration tests for the Explore orchestrator (`buildExploreRails` + the
 * four rails). Drives the whole fan-out end-to-end against an in-memory
 * Supabase with stubbed network boundaries, exercising the wiring the pure-
 * helper tests can't: rail shape (RAIL_KEYS), listened/feedback exclusion
 * inside resolveAndFilter, per-rail failure isolation (Promise.allSettled),
 * and the explore_cache write.
 *
 * Seams: identical to engine.integration.test.ts —
 *   supabase/server, music-provider/provider, lastfm-cache, itunes mocked;
 *   LASTFM_API_KEY stubbed. getTagArtistNames is driven through the mocked
 *   cachedTagArtistNames (no network, no lastfm_cache table needed).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { createFakeSupabase, type Tables, type Row } from "./__fixtures__/fake-supabase"
import { isValidArtistId } from "@/lib/spotify-ids"
import type { Track } from "@/lib/music-provider/types"
import type { SimilarArtistRef } from "@/lib/music-provider"

const h = vi.hoisted(() => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  fake: { client: null as any, tables: {} as Tables },
  similars: new Map<string, SimilarArtistRef[]>(),
  enrichment: new Map<string, { genres: string[]; popularity: number } | null>(),
  /** When true, getSimilarArtistNames throws (drives the wildcards-rail failure). */
  similarThrows: false,
  calls: { enrich: [] as string[], similar: [] as string[] },
}))

vi.mock("@/lib/supabase/server", () => ({
  createServiceClient: () => h.fake.client,
  createClient: () => h.fake.client,
}))

vi.mock("@/lib/music-provider/provider", () => ({
  musicProvider: {
    getSimilarArtistNames: async (name: string): Promise<SimilarArtistRef[]> => {
      h.calls.similar.push(name)
      if (h.similarThrows) throw new Error("simulated Last.fm getSimilar failure")
      return h.similars.get(name) ?? []
    },
    getArtistTopTracks: async (): Promise<Track[]> => [],
  },
}))

vi.mock("@/lib/lastfm-cache", () => ({
  // Every tag returns the same 10 shared "head" names + one tag-specific "mid"
  // name at index 10. Adjacent reads the head (limit 8); outside/leftfield read
  // slice(10, …) → the tag-specific mid. Keeps total unique names small (fast,
  // deterministic) while still giving each rail distinct picks.
  cachedTagArtistNames: async (tag: string, limit: number): Promise<string[]> => {
    const base = [
      ...Array.from({ length: 10 }, (_, i) => `H${i}`),
      `MID_${tag}`,
    ]
    return base.slice(0, limit)
  },
  cachedArtistEnrichment: async (name: string) => {
    h.calls.enrich.push(name)
    const key = name.toLowerCase()
    return h.enrichment.has(key) ? h.enrichment.get(key)! : { genres: ["indie"], popularity: 30 }
  },
  cachedSimilarArtistNames: async () => [],
  cachedArtistSearch: async () => [],
}))

vi.mock("@/lib/music-provider/itunes", () => ({
  searchTracksByArtist: async (name: string): Promise<Track[]> => [track(name)],
}))

// Imported AFTER mocks are registered.
import { buildExploreRails, RAIL_KEYS } from "./explore-engine"

// ── Fixtures ──────────────────────────────────────────────────────────────────
function track(seed: string): Track {
  return {
    id: `it-${seed}`,
    spotifyTrackId: null,
    name: `${seed} — Preview`,
    previewUrl: `https://audio.example.com/${seed}.m4a`,
    durationMs: 30000,
    albumName: "Album",
    albumImageUrl: null,
    source: "itunes",
  }
}

function artistsRow(id: string, name: string, opts: Partial<Row> = {}): Row {
  return {
    id,
    spotify_id: null,
    name,
    name_lower: name.toLowerCase(),
    genres: ["indie"],
    popularity: 30,
    image_url: null,
    artist_color: null,
    ...opts,
  }
}

function seed(tables: Tables): void {
  h.fake = createFakeSupabase({
    users: [{ id: "u1", selected_genres: [], adventurous: false }],
    seed_artists: [],
    feedback: [],
    listened_artists: [],
    artists: [],
    recommendation_cache: [],
    explore_cache: [],
    artist_tracks_cache: [],
    ...tables,
  })
}

function baseInput() {
  return { userId: "u1", accessToken: "", adventurous: false }
}

/** All artist ids across every rail. */
function allRailIds(rails: { artistIds: string[] }[]): string[] {
  return rails.flatMap((r) => r.artistIds)
}

beforeEach(() => {
  vi.stubEnv("LASTFM_API_KEY", "test-key")
  h.similars.clear()
  h.enrichment.clear()
  h.similarThrows = false
  h.calls.enrich = []
  h.calls.similar = []
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

// A thumbs-up seed so the wildcards rail has a real (non-fallback) source.
function withLikedSeed(extra: Tables = {}): Tables {
  const TU1 = "11111111-0000-4000-8000-000000000001"
  return {
    seed_artists: [{ user_id: "u1", artist_id: TU1, name: "LikedArtist" }],
    feedback: [{ user_id: "u1", artist_id: TU1, signal: "thumbs_up", deleted_at: null }],
    ...extra,
  }
}

// ── 6a. Shape + cache write ───────────────────────────────────────────────────
describe("buildExploreRails — shape and cache write", () => {
  it("returns all four rails with uuid ids and writes explore_cache", async () => {
    seed(withLikedSeed())
    h.similars.set("LikedArtist", [
      { name: "W0", match: 0.9 },
      { name: "W1", match: 0.3 },
      { name: "W2", match: 0.2 },
      { name: "W3", match: 0.1 },
    ])

    const { rails, cacheHit } = await buildExploreRails(baseInput())

    expect(cacheHit).toBe(false)
    // Exactly the canonical rail set, one result each.
    expect(rails.map((r) => r.railKey).sort()).toEqual([...RAIL_KEYS].sort())

    // Every surfaced id is a real minted uuid identity.
    for (const id of allRailIds(rails)) {
      expect(isValidArtistId(id)).toBe(true)
    }
    // At least the tag-driven rails produced picks.
    const byKey = Object.fromEntries(rails.map((r) => [r.railKey, r.artistIds]))
    expect(byKey.adjacent.length).toBeGreaterThan(0)
    expect(byKey.leftfield.length).toBeGreaterThan(0)

    // explore_cache persisted one row per rail (uuid ids only).
    const rows = h.fake.tables.explore_cache
    expect(rows.map((r) => r.rail_key).sort()).toEqual([...RAIL_KEYS].sort())
    for (const row of rows) {
      for (const id of row.artist_ids as string[]) expect(isValidArtistId(id)).toBe(true)
    }
  }, 20000)
})

// ── 6b. Listened / thumbs-down exclusion ──────────────────────────────────────
describe("buildExploreRails — listened + feedback exclusion", () => {
  it("never surfaces a listened or thumbs-down artist in any rail", async () => {
    const badId = "22222222-0000-4000-8000-000000000002"
    const downId = "33333333-0000-4000-8000-000000000003"
    seed(
      withLikedSeed({
        // Pre-seed → deterministic cache-hit ids for the excluded artists.
        artists: [
          artistsRow(badId, "BadArtist"),
          artistsRow(downId, "DislikedArtist"),
        ],
        listened_artists: [
          { user_id: "u1", artist_id: badId, play_count: 500 },
        ],
        feedback: [
          { user_id: "u1", artist_id: "11111111-0000-4000-8000-000000000001", signal: "thumbs_up", deleted_at: null },
          { user_id: "u1", artist_id: downId, signal: "thumbs_down", deleted_at: null },
        ],
      }),
    )
    // Wildcards seed's similars include the two excluded artists plus a keeper.
    h.similars.set("LikedArtist", [
      { name: "BadArtist", match: 0.2 },
      { name: "DislikedArtist", match: 0.15 },
      { name: "GoodArtist", match: 0.1 },
      { name: "W9", match: 0.05 },
    ])

    const { rails } = await buildExploreRails(baseInput())
    const ids = new Set(allRailIds(rails))

    expect(ids.has(badId)).toBe(false)   // listened over threshold → excluded
    expect(ids.has(downId)).toBe(false)  // thumbs-down → excluded
    // The non-excluded sibling from the same seed did resolve somewhere.
    const goodRow = h.fake.tables.artists.find((a) => a.name_lower === "goodartist")
    expect(goodRow).toBeTruthy()
    expect(ids.has(goodRow!.id)).toBe(true)
  }, 20000)
})

// ── 6c. Per-rail failure isolation ────────────────────────────────────────────
describe("buildExploreRails — rail failure isolation", () => {
  it("a throwing rail does not abort the others (allSettled)", async () => {
    seed(withLikedSeed())
    // getSimilarArtistNames throws → wildcardsRail rejects. The three tag-driven
    // rails must still generate, and buildExploreRails must not throw.
    h.similarThrows = true

    const result = await buildExploreRails(baseInput())

    // All four keys still present (the failed rail degrades to empty/topup).
    expect(result.rails.map((r) => r.railKey).sort()).toEqual([...RAIL_KEYS].sort())
    const byKey = Object.fromEntries(result.rails.map((r) => [r.railKey, r.artistIds]))
    // Tag-driven rails were unaffected by the getSimilar failure.
    expect(byKey.adjacent.length).toBeGreaterThan(0)
    expect(byKey.leftfield.length).toBeGreaterThan(0)
    // The whole build still produced a persisted cache (didn't throw out).
    expect(h.fake.tables.explore_cache.length).toBe(RAIL_KEYS.length)
  }, 20000)
})

// ── 6d. #162: freshly confirmed picks are hydratable (read-after-write) ───────
describe("buildExploreRails — freshly confirmed picks hydrate with previews (#162)", () => {
  it("persists confirmed tracks BEFORE hydration reads them, so no rail pick is a dead card", async () => {
    seed(withLikedSeed())
    h.similars.set("LikedArtist", [
      { name: "W0", match: 0.9 },
      { name: "W1", match: 0.3 },
      { name: "W2", match: 0.2 },
      { name: "W3", match: 0.1 },
    ])

    const { rails, hydrated } = await buildExploreRails(baseInput(), { hydrate: true })
    expect(hydrated).toBeDefined()

    const ids = allRailIds(rails)
    expect(ids.length).toBeGreaterThan(0)

    // The tracks cache was written during THIS request (the resolveAndFilter
    // flush) — before hydrateRailArtists read it. Every surfaced rail pick
    // therefore hydrates WITH a playable preview instead of topTracks:[].
    expect((h.fake.tables.artist_tracks_cache ?? []).length).toBeGreaterThan(0)
    for (const id of ids) {
      const rec = hydrated!.get(id)
      expect(rec).toBeTruthy()
      expect(rec!.topTracks?.some((t) => t.previewUrl)).toBe(true)
    }
  }, 20000)
})
