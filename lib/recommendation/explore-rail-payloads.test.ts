/**
 * Unit tests for explore-rail-payloads.ts — the shared rail-payload assembly
 * helper used by both the Explore page and GET /api/explore/rails.
 */
import { describe, it, expect } from "vitest"
import {
  assembleRailPayloads,
  hydrateRailArtists,
  RAIL_TITLES,
  WILDCARDS_FALLBACK_META,
} from "./explore-rail-payloads"
import type { RailResult } from "./explore-engine"
import type { HydratedRailArtist } from "./explore-engine"
import type { Track } from "@/lib/music-provider/types"

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeHydrated(
  id: string,
  overrides: Partial<HydratedRailArtist> = {},
): HydratedRailArtist {
  return {
    id,
    name: `Artist ${id}`,
    genres: ["indie"],
    imageUrl: null,
    popularity: 50,
    artist_color: null,
    topTracks: undefined, // legacy: undefined → keep (no filtering)
    ...overrides,
  }
}

function playableTrack(id: string): Track {
  return {
    id,
    spotifyTrackId: null,
    name: `Track ${id}`,
    previewUrl: `https://example.com/${id}.m4a`,
    durationMs: 30000,
    albumName: "Album",
    albumImageUrl: null,
    source: "itunes",
  }
}

function unplayableTrack(id: string): Track {
  return {
    id,
    spotifyTrackId: null,
    name: `Track ${id}`,
    previewUrl: null, // no preview
    durationMs: 30000,
    albumName: "Album",
    albumImageUrl: null,
    source: "itunes",
  }
}

function rail(
  railKey: RailResult["railKey"],
  artistIds: string[],
  whyOverrides: Record<string, object> = {},
): RailResult {
  return { railKey, artistIds, why: whyOverrides }
}

// ---------------------------------------------------------------------------
// hydrateRailArtists
// ---------------------------------------------------------------------------

describe("hydrateRailArtists", () => {
  it("maps ids to RailArtist, skipping missing entries", () => {
    const byId = new Map([["a1", makeHydrated("a1")]])
    const result = hydrateRailArtists(["a1", "missing"], {}, byId)
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe("a1")
  })

  it("keeps artists with topTracks=undefined (legacy rows)", () => {
    const a = makeHydrated("a1", { topTracks: undefined })
    const result = hydrateRailArtists(["a1"], {}, new Map([["a1", a]]))
    expect(result).toHaveLength(1)
  })

  it("keeps artists that have at least one playable track", () => {
    const a = makeHydrated("a1", { topTracks: [playableTrack("t1")] })
    const result = hydrateRailArtists(["a1"], {}, new Map([["a1", a]]))
    expect(result).toHaveLength(1)
  })

  it("drops artists whose topTracks are all unplayable", () => {
    const a = makeHydrated("a1", { topTracks: [unplayableTrack("t1")] })
    const result = hydrateRailArtists(["a1"], {}, new Map([["a1", a]]))
    expect(result).toHaveLength(0)
  })

  it("copies why fields when present", () => {
    const a = makeHydrated("a1")
    const why = { a1: { sourceArtist: "Portishead", tag: "trip-hop" } }
    const result = hydrateRailArtists(["a1"], why, new Map([["a1", a]]))
    expect(result[0].why?.sourceArtist).toBe("Portishead")
    expect(result[0].why?.tag).toBe("trip-hop")
  })

  it("leaves why undefined when not present", () => {
    const a = makeHydrated("a1")
    const result = hydrateRailArtists(["a1"], {}, new Map([["a1", a]]))
    expect(result[0].why).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// assembleRailPayloads — titles and fallback detection
// ---------------------------------------------------------------------------

describe("assembleRailPayloads", () => {
  it("assigns correct title/subtitle for each rail key", () => {
    const rails: RailResult[] = [
      rail("adjacent", []),
      rail("outside", []),
      rail("wildcards", []),
      rail("leftfield", []),
    ]
    const payloads = assembleRailPayloads(rails, new Map())
    const keys = payloads.map((p) => p.railKey)
    expect(keys).toEqual(["adjacent", "outside", "wildcards", "leftfield"])
    for (const p of payloads) {
      expect(p.title).toBe(RAIL_TITLES[p.railKey].title)
      expect(p.subtitle).toBe(RAIL_TITLES[p.railKey].subtitle)
    }
  })

  it("uses WILDCARDS_FALLBACK_META when the __meta fallbackKind marker is set", () => {
    const wildcardsRail: RailResult = {
      railKey: "wildcards",
      artistIds: [],
      why: { __meta: { fallbackKind: "leftfield-for-wildcards" } },
    }
    const payloads = assembleRailPayloads([wildcardsRail], new Map())
    expect(payloads[0].title).toBe(WILDCARDS_FALLBACK_META.title)
    expect(payloads[0].subtitle).toBe(WILDCARDS_FALLBACK_META.subtitle)
  })

  it("does NOT use fallback meta for wildcards without the marker", () => {
    const wildcardsRail: RailResult = {
      railKey: "wildcards",
      artistIds: [],
      why: {},
    }
    const payloads = assembleRailPayloads([wildcardsRail], new Map())
    expect(payloads[0].title).toBe(RAIL_TITLES.wildcards.title)
  })

  it("hydrates artists when artistById is populated", () => {
    const a1 = makeHydrated("a1")
    const byId = new Map([["a1", a1]])
    const r = rail("adjacent", ["a1"])
    const payloads = assembleRailPayloads([r], byId)
    expect(payloads[0].artists).toHaveLength(1)
    expect(payloads[0].artists[0].id).toBe("a1")
  })

  it("returns empty artists array for unknown ids (no crash)", () => {
    const r = rail("adjacent", ["ghost-id"])
    const payloads = assembleRailPayloads([r], new Map())
    expect(payloads[0].artists).toHaveLength(0)
  })

  it("returns empty payloads array when rails is empty", () => {
    expect(assembleRailPayloads([], new Map())).toEqual([])
  })
})
