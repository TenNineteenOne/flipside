/**
 * Integration tests for the For You orchestrator (`buildRecommendations` →
 * `runWithSoftening` → `runPipeline`). Unlike engine.test.ts — which tests the
 * extracted PURE helpers — these drive the whole pipeline end-to-end with an
 * in-memory Supabase and stubbed network boundaries, so they exercise the
 * WIRING: which cache is constructed, resolve → filter → score → confirm
 * ordering, mint identity, and the recommendation_cache writes where the
 * #143/#145/#161-class bugs actually lived.
 *
 * Seams used (no production file is modified):
 *   - vi.mock('@/lib/supabase/server')      → in-memory FakeSupabase
 *   - vi.mock('@/lib/music-provider/provider') → getSimilarArtistNames stub
 *   - vi.mock('@/lib/lastfm-cache')         → enrichment + tag stubs (bypasses
 *                                             the network AND the lastfm_cache
 *                                             table in one seam)
 *   - vi.mock('@/lib/music-provider/itunes') → searchTracksByArtist stub
 *   - vi.stubEnv('LASTFM_API_KEY', …)        → unlocks lastfmResolve/enrich
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { createFakeSupabase, type Tables, type Row } from "./__fixtures__/fake-supabase"
import { isValidArtistId } from "@/lib/spotify-ids"
import type { Track } from "@/lib/music-provider/types"
import type { SimilarArtistRef } from "@/lib/music-provider"

// ── Hoisted mock control surface ──────────────────────────────────────────────
const h = vi.hoisted(() => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  fake: { client: null as any, tables: {} as Tables },
  similars: new Map<string, SimilarArtistRef[]>(),
  /** name_lower → enrichment (or null for genuine "not found"). Default: enriched. */
  enrichment: new Map<string, { genres: string[]; popularity: number } | null>(),
  /** artist name → iTunes tracks (or null). Default: one playable track. */
  itunes: new Map<string, Track[] | null>(),
  calls: { enrich: [] as string[], similar: [] as string[], itunes: [] as string[] },
}))

vi.mock("@/lib/supabase/server", () => ({
  createServiceClient: () => h.fake.client,
  createClient: () => h.fake.client,
}))

vi.mock("@/lib/music-provider/provider", () => ({
  musicProvider: {
    getSimilarArtistNames: async (name: string): Promise<SimilarArtistRef[]> => {
      h.calls.similar.push(name)
      return h.similars.get(name) ?? []
    },
    getArtistTopTracks: async (): Promise<Track[]> => [],
  },
}))

vi.mock("@/lib/lastfm-cache", () => ({
  cachedArtistEnrichment: async (name: string) => {
    h.calls.enrich.push(name)
    const key = name.toLowerCase()
    return h.enrichment.has(key) ? h.enrichment.get(key)! : { genres: ["indie"], popularity: 30 }
  },
  cachedTagArtistNames: async () => [],
  cachedSimilarArtistNames: async () => [],
  cachedArtistSearch: async () => [],
}))

vi.mock("@/lib/music-provider/itunes", () => ({
  searchTracksByArtist: async (name: string): Promise<Track[] | null> => {
    h.calls.itunes.push(name)
    return h.itunes.has(name) ? h.itunes.get(name)! : [track(name)]
  },
}))

// Imported AFTER mocks are registered.
import { buildRecommendations } from "./engine"

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
    ...opts,
  }
}

function similarRefs(names: string[]): SimilarArtistRef[] {
  // Descending match so tail-first round-robin still has a stable ordering.
  return names.map((name, i) => ({ name, match: 1 - i * 0.01 }))
}

/** Build the fake DB + assign it to the hoisted control surface. */
function seed(tables: Tables): void {
  h.fake = createFakeSupabase({
    users: [{ id: "u1", selected_genres: [] }],
    seed_artists: [],
    feedback: [],
    listened_artists: [],
    artists: [],
    recommendation_cache: [],
    artist_tracks_cache: [],
    ...tables,
  })
}

function baseInput() {
  return {
    userId: "u1",
    accessToken: "",
    playThreshold: 5,
    popularityCurve: 0.95,
  }
}

function cacheRows(): Row[] {
  return h.fake.tables.recommendation_cache ?? []
}

beforeEach(() => {
  vi.stubEnv("LASTFM_API_KEY", "test-key")
  h.similars.clear()
  h.enrichment.clear()
  h.itunes.clear()
  h.calls.enrich = []
  h.calls.similar = []
  h.calls.itunes = []
})

afterEach(() => {
  vi.unstubAllEnvs()
})

// ── 1. Happy path: seeds → fan-out → resolve(miss→mint) → confirm → write ────
describe("buildRecommendations — happy path", () => {
  it("resolves fresh names, mints uuid identities, and writes confirmed rows", async () => {
    const similarNames = Array.from({ length: 8 }, (_, i) => `Sim${i}`)
    seed({
      seed_artists: [
        { user_id: "u1", name: "SeedA" },
        { user_id: "u1", name: "SeedB" },
        { user_id: "u1", name: "SeedC" },
      ],
    })
    for (const s of ["SeedA", "SeedB", "SeedC"]) {
      h.similars.set(s, similarRefs(similarNames.map((n) => `${s}-${n}`)))
    }

    const result = await buildRecommendations(baseInput())
    // Tier 1 writes FIRST_BATCH_TARGET (8); drain the background pass for the rest.
    expect(result.count).toBeGreaterThan(0)
    await result.runSecondary?.()

    const rows = cacheRows()
    expect(rows.length).toBeGreaterThanOrEqual(8)

    // #161 bug class: every written artist_id is a real minted uuid identity —
    // never an empty string, never a placeholder.
    for (const row of rows) {
      expect(row.artist_id).toBeTruthy()
      expect(row.artist_id).not.toBe("")
      expect(isValidArtistId(row.artist_id)).toBe(true)
      expect(row.artist_data?.name).toBeTruthy()
      // Confirmed-playable guarantee: written artists carry ≥1 preview track.
      expect(row.artist_data?.topTracks?.length ?? 0).toBeGreaterThan(0)
      expect(row.user_id).toBe("u1")
    }

    // Each unique resolved name minted exactly ONE artists row (no #161 dup pile).
    const byNameLower = new Map<string, number>()
    for (const a of h.fake.tables.artists) {
      byNameLower.set(a.name_lower, (byNameLower.get(a.name_lower) ?? 0) + 1)
    }
    for (const [, count] of byNameLower) expect(count).toBe(1)
  })
})

// ── 2. Warm name-cache: cached names skip live resolve, writes don't clobber ──
describe("buildRecommendations — warm name cache", () => {
  it("serves cached names without a live resolve and preserves richer metadata", async () => {
    const warmNames = ["Warm0", "Warm1", "Warm2", "Warm3"]
    // Pre-seed canonical artists rows (single row per name_lower → cache HIT),
    // each with RICH metadata that a sparse resolve must not blank out.
    const warmRows = warmNames.map((n, i) =>
      artistsRow(`0000000${i}-0000-4000-8000-00000000000${i}`, n, {
        genres: ["richgenre"],
        popularity: 42,
      }),
    )
    seed({ seed_artists: [{ user_id: "u1", name: "SeedA" }], artists: warmRows })
    h.similars.set("SeedA", similarRefs(warmNames))

    await buildRecommendations(baseInput())

    // No live enrichment (== searchArtists) fired for any warm/cached name.
    for (const n of warmNames) {
      expect(h.calls.enrich).not.toContain(n)
    }

    // Fill-only write policy: the pre-seeded rich metadata survived the run —
    // the confirm write-back never clobbered genres/popularity down.
    for (const r of h.fake.tables.artists) {
      expect(r.genres).toEqual(["richgenre"])
      expect(r.popularity).toBe(42)
    }
  })
})

// ── 3. Ambiguous name: two rows share name_lower → treated as a miss ──────────
describe("buildRecommendations — ambiguous cached name (doorway rule)", () => {
  it("resolves an ambiguous name fresh instead of guessing a cached row", async () => {
    // Two artists rows share name_lower "ambig" → batchRead omits it (miss).
    seed({
      seed_artists: [{ user_id: "u1", name: "SeedA" }],
      artists: [
        artistsRow("aaaaaaaa-0000-4000-8000-000000000001", "Ambig"),
        artistsRow("bbbbbbbb-0000-4000-8000-000000000002", "Ambig"),
      ],
    })
    h.similars.set("SeedA", similarRefs(["Ambig"]))

    await buildRecommendations(baseInput())

    // Doorway rule: the ambiguous name was resolved fresh (enrichment fired for
    // it) rather than silently served from one of the two duplicate rows.
    expect(h.calls.enrich).toContain("Ambig")
  })
})

// ── 4. Listened / thumbs-down artists never surface in output ─────────────────
describe("buildRecommendations — listened + feedback filtering", () => {
  it("excludes over-threshold listened and thumbs-down artists from the feed", async () => {
    const listenedId = "cccccccc-0000-4000-8000-000000000001"
    const downId = "dddddddd-0000-4000-8000-000000000002"
    // Pre-seed so these two names are deterministic cache hits with known ids.
    seed({
      seed_artists: [{ user_id: "u1", name: "SeedA" }],
      artists: [
        artistsRow(listenedId, "ListenedHeavy"),
        artistsRow(downId, "Disliked"),
        artistsRow("eeeeeeee-0000-4000-8000-000000000003", "Keeper"),
      ],
      listened_artists: [
        // play_count 999 > threshold 5 → filtered by artist_id.
        { user_id: "u1", artist_id: listenedId, lastfm_artist_name: "ListenedHeavy", play_count: 999 },
      ],
      feedback: [
        { user_id: "u1", artist_id: downId, signal: "thumbs_down", deleted_at: null },
      ],
    })
    h.similars.set("SeedA", similarRefs(["ListenedHeavy", "Disliked", "Keeper"]))

    const result = await buildRecommendations(baseInput())
    await result.runSecondary?.()

    const writtenIds = new Set(cacheRows().map((r) => r.artist_id))
    expect(writtenIds.has(listenedId)).toBe(false)
    expect(writtenIds.has(downId)).toBe(false)
    // Sanity: the un-filtered "Keeper" DID make it through.
    expect(writtenIds.has("eeeeeeee-0000-4000-8000-000000000003")).toBe(true)
  })
})

// ── 5. Degraded resolver: unresolved names drop out without throwing ──────────
describe("buildRecommendations — degraded resolver", () => {
  it("degrades to fewer artists when names fail to resolve (no throw)", async () => {
    const names = Array.from({ length: 6 }, (_, i) => `Cand${i}`)
    seed({ seed_artists: [{ user_id: "u1", name: "SeedA" }] })
    h.similars.set("SeedA", similarRefs(names))
    // Half the names come back as genuine "not found" (null enrichment) — the
    // resolve layer skips them and the pipeline continues rather than throwing.
    h.enrichment.set("cand0", null)
    h.enrichment.set("cand1", null)
    h.enrichment.set("cand2", null)

    const result = await buildRecommendations(baseInput())
    await result.runSecondary?.()

    const writtenNames = new Set(cacheRows().map((r) => r.artist_data?.name))
    // The three not-found names never resolved → never written.
    expect(writtenNames.has("Cand0")).toBe(false)
    expect(writtenNames.has("Cand1")).toBe(false)
    expect(writtenNames.has("Cand2")).toBe(false)
    // The three resolvable ones did.
    expect(cacheRows().length).toBe(3)
  })
})

// ── 6. Cold start: no seeds → curated fallback still writes a feed ────────────
describe("buildRecommendations — cold start", () => {
  it("falls back to curated cold-start seeds when the user has no seeds", async () => {
    seed({}) // no seed_artists, no genres, no likes
    // Whatever cold-start seeds are chosen, give them all similars so the
    // fallback path produces a non-empty pool.
    const { musicProvider } = await import("@/lib/music-provider/provider")
    vi.spyOn(musicProvider, "getSimilarArtistNames").mockImplementation(async (seedName: string) => {
      h.calls.similar.push(seedName)
      return similarRefs([`${seedName}-x`, `${seedName}-y`, `${seedName}-z`])
    })

    const result = await buildRecommendations(baseInput())
    await result.runSecondary?.()

    expect(h.calls.similar.length).toBeGreaterThan(0) // cold-start seeds fanned out
    expect(cacheRows().length).toBeGreaterThan(0)
    for (const row of cacheRows()) {
      expect(isValidArtistId(row.artist_id)).toBe(true)
    }
  })
})
