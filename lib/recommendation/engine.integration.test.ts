/**
 * Integration tests for the For You orchestrator (`buildRecommendations` →
 * `runWithSoftening` → `runPipeline`). Unlike engine.test.ts — which tests the
 * extracted PURE helpers — these drive the whole pipeline end-to-end with an
 * in-memory Supabase and stubbed network boundaries, so they exercise the
 * WIRING: which cache is constructed, resolve → filter → score → confirm
 * ordering, mint identity, and the recommendation_cache writes where the
 * #143/#145/#161-class bugs actually lived.
 *
 * Pipeline-level cases (casing, rehydrate positive/negative, persistence
 * rules, exclusion gate) live in playable-candidates.test.ts with fake ports;
 * this suite covers the For You wiring + scoring/picking end-to-end.
 *
 * Seams used (no production file is modified):
 *   - vi.mock('@/lib/supabase/server')      → in-memory FakeSupabase
 *   - vi.mock('@/lib/lastfm')               → the in-memory fake Last.fm adapter
 *                                             (similar / getInfo / tags; no
 *                                             network, no lastfm_cache table)
 *   - vi.mock('@/lib/music-provider/itunes') → searchTracksByArtist stub
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { createFakeSupabase, type Tables, type Row } from "./__fixtures__/fake-supabase"
import { isValidArtistId } from "@/lib/spotify-ids"
import type { Track } from "@/lib/music-provider/types"
import { lastfm, type SimilarArtistRef } from "@/lib/lastfm"
import type { FakeLastfm } from "./__fixtures__/fake-lastfm"

// ── Hoisted mock control surface ──────────────────────────────────────────────
const h = vi.hoisted(() => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  fake: { client: null as any, tables: {} as Tables },
  /** artist name → iTunes tracks (or null). Default: one playable track. */
  itunes: new Map<string, Track[] | null>(),
  calls: { itunes: [] as string[] },
}))

vi.mock("@/lib/supabase/server", () => ({
  createServiceClient: () => h.fake.client,
  createClient: () => h.fake.client,
}))

vi.mock("@/lib/lastfm", async () => ({
  lastfm: (await import("./__fixtures__/fake-lastfm")).createFakeLastfm(),
}))

vi.mock("@/lib/music-provider/itunes", () => ({
  searchTracksByArtist: async (name: string): Promise<Track[] | null> => {
    h.calls.itunes.push(name)
    return h.itunes.has(name) ? h.itunes.get(name)! : [track(name)]
  },
}))

const lf = lastfm as FakeLastfm
/** tag → Last.fm tag.gettopartists names (default: none). */
const tagArtists = new Map<string, string[]>()

// Imported AFTER mocks are registered.
import { buildRecommendations } from "./engine"
import { getUnseenRecommendations } from "./feed-query"

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
  lf.reset()
  lf.tags = (tag) => tagArtists.get(tag) ?? []
  tagArtists.clear()
  h.itunes.clear()
  h.calls.itunes = []
})

afterEach(() => {
  vi.unstubAllEnvs()
  // Restore any vi.spyOn (e.g. the cold-start test's similarArtists spy,
  // the run-2 test's Math.random spy) so it can't leak into a later test's
  // module mocks. Mirrors the explore integration suite's afterEach.
  vi.restoreAllMocks()
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
      lf.similars.set(s, similarRefs(similarNames.map((n) => `${s}-${n}`)))
    }

    const result = await buildRecommendations(baseInput())
    // Tier 1 writes FIRST_BATCH_TARGET (8); drain the background pass for the rest.
    expect(result.count).toBeGreaterThan(0)
    await result.finish()

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
    lf.similars.set("SeedA", similarRefs(warmNames))

    await buildRecommendations(baseInput())

    // No live enrichment (== searchArtists) fired for any warm/cached name.
    for (const n of warmNames) {
      expect(lf.calls.enrich).not.toContain(n)
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
    lf.similars.set("SeedA", similarRefs(["Ambig"]))

    await buildRecommendations(baseInput())

    // Doorway rule: the ambiguous name was resolved fresh (enrichment fired for
    // it) rather than silently served from one of the two duplicate rows.
    expect(lf.calls.enrich).toContain("Ambig")
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
    lf.similars.set("SeedA", similarRefs(["ListenedHeavy", "Disliked", "Keeper"]))

    const result = await buildRecommendations(baseInput())
    await result.finish()

    const writtenIds = new Set(cacheRows().map((r) => r.artist_id))
    expect(writtenIds.has(listenedId)).toBe(false)
    expect(writtenIds.has(downId)).toBe(false)
    // Sanity: the un-filtered "Keeper" DID make it through.
    expect(writtenIds.has("eeeeeeee-0000-4000-8000-000000000003")).toBe(true)
  })
})

// ── 4b. Cooldown / dismissed applied BEFORE confirm (#175 D3) ────────────────
describe("buildRecommendations — cooldown excluded before confirm", () => {
  it("never spends an iTunes call on a seen-in-7-days or dismissed artist", async () => {
    const seenId = "f0000000-0000-4000-8000-000000000001"
    const skipId = "f0000000-0000-4000-8000-000000000002"
    seed({
      seed_artists: [{ user_id: "u1", name: "SeedA" }],
      artists: [artistsRow(seenId, "SeenRecently"), artistsRow(skipId, "Dismissed")],
      recommendation_cache: [
        { user_id: "u1", artist_id: seenId, seen_at: new Date().toISOString(), skip_at: null },
        { user_id: "u1", artist_id: skipId, seen_at: null, skip_at: new Date().toISOString() },
      ],
    })
    lf.similars.set("SeedA", similarRefs(["SeenRecently", "Dismissed", "Fresh0", "Fresh1"]))

    const result = await buildRecommendations(baseInput())
    await result.finish()

    expect(h.calls.itunes).not.toContain("SeenRecently")
    expect(h.calls.itunes).not.toContain("Dismissed")
    const written = cacheRows().filter((r) => r.artist_data).map((r) => r.artist_data.name)
    expect(written.sort()).toEqual(["Fresh0", "Fresh1"])
  })
})

// ── 5. Degraded resolver: unresolved names drop out without throwing ──────────
describe("buildRecommendations — degraded resolver", () => {
  it("degrades to fewer artists when names fail to resolve (no throw)", async () => {
    const names = Array.from({ length: 6 }, (_, i) => `Cand${i}`)
    seed({ seed_artists: [{ user_id: "u1", name: "SeedA" }] })
    lf.similars.set("SeedA", similarRefs(names))
    // Half the names come back as genuine "not found" (null enrichment) — the
    // resolve layer skips them and the pipeline continues rather than throwing.
    lf.enrichment.set("cand0", null)
    lf.enrichment.set("cand1", null)
    lf.enrichment.set("cand2", null)

    const result = await buildRecommendations(baseInput())
    await result.finish()

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
    vi.spyOn(lf, "similarArtists").mockImplementation(async (seedName: string) => {
      lf.calls.similar.push(seedName)
      return similarRefs([`${seedName}-x`, `${seedName}-y`, `${seedName}-z`])
    })

    const result = await buildRecommendations(baseInput())
    await result.finish()

    expect(lf.calls.similar.length).toBeGreaterThan(0) // cold-start seeds fanned out
    expect(cacheRows().length).toBeGreaterThan(0)
    for (const row of cacheRows()) {
      expect(isValidArtistId(row.artist_id)).toBe(true)
    }
  })
})

// ── 7. #162: persist confirmed previews to artist_tracks_cache ────────────────
function tracksCacheRows(): Row[] {
  return h.fake.tables.artist_tracks_cache ?? []
}

describe("buildRecommendations — persist confirms (#162)", () => {
  it("finish() writes positive rows with source + fetched_at", async () => {
    seed({ seed_artists: [{ user_id: "u1", name: "SeedA" }] })
    lf.similars.set("SeedA", similarRefs(Array.from({ length: 6 }, (_, i) => `Pos${i}`)))

    const result = await buildRecommendations(baseInput())
    await result.finish()

    const rows = tracksCacheRows()
    expect(rows.length).toBeGreaterThan(0)
    for (const row of rows) {
      expect(isValidArtistId(row.artist_id)).toBe(true)
      expect(row.source).toBe("itunes")
      expect(row.tracks.length).toBeGreaterThan(0)
      expect(typeof row.fetched_at).toBe("string")
    }
  })

  it("run 2 makes ZERO iTunes calls for artists confirmed + persisted in run 1", async () => {
    // Pin shuffle nondeterminism so both runs resolve the same candidate set.
    const rand = vi.spyOn(Math, "random").mockReturnValue(0.42)
    const names = Array.from({ length: 10 }, (_, i) => `Warm${i}`)
    seed({ seed_artists: [{ user_id: "u1", name: "SeedA" }] })
    lf.similars.set("SeedA", similarRefs(names))

    // Run 1 (cold): confirms via iTunes, persists positives to artist_tracks_cache.
    const r1 = await buildRecommendations(baseInput())
    await r1.finish()
    expect(h.calls.itunes.length).toBeGreaterThan(0)
    expect(tracksCacheRows().length).toBeGreaterThan(0)

    // Run 2 (warm): rehydrate short-circuits every confirm — no iTunes at all.
    h.calls.itunes = []
    const r2 = await buildRecommendations(baseInput())
    await r2.finish()
    expect(h.calls.itunes).toEqual([])

    rand.mockRestore()
  })
})

// ── 8. #175 D2: adjacent-bleed picks go through rehydrate ─────────────────────
describe("buildRecommendations — adjacent bleed is rehydrated (#175 D2)", () => {
  it("a bleed pick with a cached preview is written without an iTunes call", async () => {
    const bleedId = "b1eed000-0000-4000-8000-000000000001"
    seed({
      users: [{ id: "u1", selected_genres: ["indie-rock"] }],
      seed_artists: [{ user_id: "u1", name: "SeedA" }],
      artists: [artistsRow(bleedId, "BleedArtist")],
      artist_tracks_cache: [
        { artist_id: bleedId, tracks: [track("cached-bleed")], source: "itunes", fetched_at: new Date().toISOString() },
      ],
    })
    lf.similars.set("SeedA", similarRefs(Array.from({ length: 10 }, (_, i) => `Base${i}`)))
    // Every adjacent tag of indie-rock yields the bleed artist; the user's own
    // genre (used for genre seeds) yields nothing.
    const { adjacentGenres } = await import("@/lib/genre/adjacency")
    for (const tag of adjacentGenres("indie-rock", "close")) tagArtists.set(tag, ["BleedArtist"])

    const result = await buildRecommendations(baseInput())
    await result.finish()

    const bleedRow = cacheRows().find((r) => r.artist_id === bleedId)
    expect(bleedRow?.source).toBe("adjacent_bleed")
    expect(bleedRow?.artist_data.topTracks[0].id).toBe("it-cached-bleed")
    // Old code handed bleed picks `topTracks: []` (never rehydrated) → iTunes.
    expect(h.calls.itunes).not.toContain("BleedArtist")
  })
})

// ── #175 F17: writeScored fails safe when its cooldown read errors ──────────
describe("buildRecommendations — writeScored cooldown read error (#175 F17)", () => {
  it("writes nothing (never nulls an existing seen_at) when the cooldown read fails", async () => {
    const oldId = "f0000000-0000-4000-8000-000000000003"
    const seenAt = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString()
    seed({
      seed_artists: [{ user_id: "u1", name: "SeedA" }],
      artists: [artistsRow(oldId, "SeenLongAgo")],
      recommendation_cache: [{ user_id: "u1", artist_id: oldId, seen_at: seenAt, skip_at: null }],
    })
    lf.similars.set("SeedA", similarRefs(["SeenLongAgo", "Fresh0"]))
    // Fail only writeScored's `.in('artist_id', ids)` read on recommendation_cache.
    const origFrom = h.fake.client.from
    h.fake.client.from = (t: string) => {
      const q = origFrom(t)
      if (t === "recommendation_cache") {
        q.in = () => ({
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          then: (res: (v: any) => any) => Promise.resolve({ data: null, error: { message: "boom" } }).then(res),
        })
      }
      return q
    }
    vi.spyOn(console, "error").mockImplementation(() => {})

    const result = await buildRecommendations(baseInput())
    await result.finish()

    expect(result.count).toBe(0)
    const rows = cacheRows()
    expect(rows).toHaveLength(1)
    expect(rows[0].seen_at).toBe(seenAt)
  })
})

// ── #175 F19: tier1 log fields keep their baseline meaning ──────────────────
describe("buildRecommendations — tier1 log semantics (#175 F19)", () => {
  it("cands counts pre-gate resolved ids; filtListened counts distinct listened ids", async () => {
    const knownId = "f0000000-0000-4000-8000-000000000004"
    seed({
      seed_artists: [{ user_id: "u1", name: "SeedA" }],
      artists: [artistsRow(knownId, "Known")],
      listened_artists: [{ id: "l1", user_id: "u1", artist_id: knownId, play_count: 99 }],
    })
    lf.similars.set("SeedA", similarRefs(["Known", "Fresh0", "Fresh1"]))
    const log = vi.spyOn(console, "log").mockImplementation(() => {})

    await buildRecommendations(baseInput())

    const tier1 = log.mock.calls.map((c) => String(c[0])).find((l) => l.startsWith("[engine] tier1"))
    expect(tier1).toContain("filtListened=1 ")
    expect(tier1).toContain("cands=3 ")
  })
})

// ── #175 F20: seed provenance survives casing differences ───────────────────
describe("buildRecommendations — seed provenance casing (#175 F20)", () => {
  it("credits every seed that surfaced a candidate, whatever casing each used", async () => {
    seed({ seed_artists: [{ user_id: "u1", name: "SeedA" }, { user_id: "u1", name: "SeedB" }] })
    lf.similars.set("SeedA", similarRefs(["Boards of Canada"]))
    lf.similars.set("SeedB", similarRefs(["Boards Of Canada"]))

    const result = await buildRecommendations(baseInput())
    await result.finish()

    const row = cacheRows().find((r) => r.artist_data?.name.toLowerCase() === "boards of canada")
    expect(row?.why.sourceArtists.sort()).toEqual(["SeedA", "SeedB"])
  })
})

// ── #175 F26 (owner decision D1): seen > 7 days ago resurfaces ──────────────
describe("buildRecommendations — resurfacing (#175 F26 / D1)", () => {
  it("a seen-long-ago artist is rewritten unseen with a fresh created_at and reaches the feed; dismissed stays hidden", async () => {
    const oldId = "f0000000-0000-4000-8000-000000000005"
    const skipId = "f0000000-0000-4000-8000-000000000006"
    const longAgo = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString()
    seed({
      seed_artists: [{ user_id: "u1", name: "SeedA" }],
      artists: [artistsRow(oldId, "SeenLongAgo"), artistsRow(skipId, "Dismissed")],
      recommendation_cache: [
        { id: "c1", user_id: "u1", artist_id: oldId, seen_at: longAgo, skip_at: null, created_at: longAgo, expires_at: longAgo },
        { id: "c2", user_id: "u1", artist_id: skipId, seen_at: longAgo, skip_at: longAgo, created_at: longAgo, expires_at: longAgo },
      ],
    })
    lf.similars.set("SeedA", similarRefs(["SeenLongAgo", "Dismissed", "Fresh0"]))

    const result = await buildRecommendations(baseInput())
    await result.finish()

    const resurfaced = cacheRows().find((r) => r.artist_id === oldId)!
    expect(resurfaced.seen_at).toBeNull()
    expect(new Date(resurfaced.created_at).getTime()).toBeGreaterThan(Date.now() - 60_000)
    const dismissed = cacheRows().find((r) => r.artist_id === skipId)!
    expect(dismissed.skip_at).toBe(longAgo) // untouched

    const unseen = await getUnseenRecommendations(h.fake.client, "u1", { limit: 20, undergroundMode: false })
    const ids = unseen.map((r) => r.artist_id)
    expect(ids).toContain(oldId)
    expect(ids).not.toContain(skipId)
  })

  it("never puts skip_at in an upsert payload (a concurrent dismiss can't be overwritten)", async () => {
    const oldId = "f0000000-0000-4000-8000-000000000007"
    const longAgo = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString()
    seed({
      seed_artists: [{ user_id: "u1", name: "SeedA" }],
      artists: [artistsRow(oldId, "SeenLongAgo")],
      recommendation_cache: [{ id: "c1", user_id: "u1", artist_id: oldId, seen_at: longAgo, skip_at: null, created_at: longAgo }],
    })
    lf.similars.set("SeedA", similarRefs(["SeenLongAgo", "Fresh0"]))
    const payloads: Row[][] = []
    const origFrom = h.fake.client.from
    h.fake.client.from = (t: string) => {
      const q = origFrom(t)
      if (t === "recommendation_cache") {
        const origUpsert = q.upsert
        q.upsert = (rows: Row[], o: unknown) => {
          payloads.push(rows)
          return origUpsert(rows, o)
        }
      }
      return q
    }

    const result = await buildRecommendations(baseInput())
    await result.finish()

    expect(payloads.length).toBeGreaterThan(0)
    for (const rows of payloads) {
      for (const r of rows) expect(r).not.toHaveProperty("skip_at")
      // One column set per upsert (PostgREST nulls keys missing from some rows).
      const keySets = new Set(rows.map((r) => Object.keys(r).sort().join(",")))
      expect(keySets.size).toBe(1)
    }
  })
})

// ── #175 F15: genre seeds request the default tag limit ─────────────────────
describe("buildRecommendations — genre seed tag limit (#175 F15)", () => {
  it("asks Last.fm for the default 20 artists per selected genre (not the array index)", async () => {
    const genres = ["g-a", "g-b", "g-c", "g-d", "g-e"]
    seed({ users: [{ id: "u1", selected_genres: genres }] })
    const limits = new Map<string, number[]>()
    lf.tags = (tag, limit) => {
      limits.set(tag, [...(limits.get(tag) ?? []), limit])
      return []
    }

    await buildRecommendations(baseInput())

    for (const g of genres) expect(limits.get(g)).toEqual([20])
  })
})

// ── #175 F-A: onboarding seed artists always shape the feed ─────────────────
describe("buildRecommendations — picked seeds always used (#175 F-A)", () => {
  it("every picked seed is fanned out even when genre tags add 40 names; picks are never recommended back", async () => {
    const picks = ["PickA", "PickB", "PickC"]
    for (let run = 0; run < 5; run++) {
      seed({
        users: [{ id: "u1", selected_genres: ["g-a", "g-b"] }],
        seed_artists: picks.map((name) => ({ user_id: "u1", name })),
      })
      lf.reset()
      lf.tags = (tag) => Array.from({ length: 20 }, (_, i) => `${tag}-artist${i}`)
      // Every genre seed's similars include a picked seed: it must never come back as a rec.
      for (const g of ["g-a", "g-b"]) {
        for (let i = 0; i < 20; i++) lf.similars.set(`${g}-artist${i}`, similarRefs(["pickc", `${g}-${i}-sim`]))
      }
      for (const p of picks) lf.similars.set(p, similarRefs([`${p}-sim`]))

      const result = await buildRecommendations(baseInput())
      await result.finish()

      for (const p of picks) expect(lf.calls.similar).toContain(p)
      expect(lf.calls.similar.length).toBe(10) // the seed cap still holds
      const names = cacheRows().map((r) => r.artist_data?.name.toLowerCase())
      expect(names.length).toBeGreaterThan(0)
      expect(names).not.toContain("pickc")
    }
  })
})

// ── #175 F-B (owner decision D1): liked / saved never resurface ─────────────
describe("buildRecommendations — liked and saved never resurface (#175 F-B)", () => {
  it("thumbs-up and saved artists stay hidden past the cooldown and after their cache row is gone", async () => {
    const id = (n: number) => `f0000000-0000-4000-8000-0000000000${10 + n}`
    const longAgo = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString()
    const old = { seen_at: longAgo, skip_at: null, created_at: longAgo, expires_at: longAgo }
    seed({
      seed_artists: [{ user_id: "u1", name: "SeedA" }],
      artists: [
        artistsRow(id(1), "LikedOld"),
        artistsRow(id(2), "SavedOld"),
        artistsRow(id(3), "LikedGone"),
        artistsRow(id(4), "PassedBy"),
      ],
      feedback: [
        { id: "fb1", user_id: "u1", artist_id: id(1), signal: "thumbs_up", deleted_at: null },
        { id: "fb2", user_id: "u1", artist_id: id(3), signal: "thumbs_up", deleted_at: null },
      ],
      saves: [{ id: "sv1", user_id: "u1", artist_id: id(2) }],
      recommendation_cache: [
        { id: "c1", user_id: "u1", artist_id: id(1), ...old },
        { id: "c2", user_id: "u1", artist_id: id(2), ...old },
        { id: "c4", user_id: "u1", artist_id: id(4), ...old },
      ],
    })
    lf.similars.set("SeedA", similarRefs(["LikedOld", "SavedOld", "LikedGone", "PassedBy"]))

    const result = await buildRecommendations(baseInput())
    await result.finish()

    const byId = new Map(cacheRows().map((r) => [r.artist_id, r]))
    expect(byId.get(id(1))!.seen_at).toBe(longAgo)
    expect(byId.get(id(2))!.seen_at).toBe(longAgo)
    expect(byId.has(id(3))).toBe(false)
    expect(byId.get(id(4))!.seen_at).toBeNull() // scrolled-past still resurfaces (D1)
  })
})
