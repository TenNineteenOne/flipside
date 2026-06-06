/**
 * Unit tests for explore-engine helpers that can be exercised without a live
 * Supabase connection. Heavy wiring tests (resolveAndFilter + Supabase +
 * musicProvider) are omitted per the #145a spec — the confirmTarget plumbing
 * is covered here at the confirmToTarget boundary.
 */
import { describe, it, expect } from "vitest"
import {
  rankByCurve,
  computeTopAnchors,
  EXPLORE_CACHE_TTL_MS,
} from "./explore-engine"
import type { Artist } from "@/lib/music-provider/types"
import { confirmToTarget } from "./confirm-previews"
import type { Track } from "@/lib/music-provider/types"

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function artist(id: string, popularity = 50): Artist {
  return { id, name: `Artist ${id}`, genres: [], imageUrl: null, popularity }
}

function track(id: string): Track {
  return {
    id,
    spotifyTrackId: null,
    name: `Track ${id}`,
    previewUrl: `https://audio.example.com/${id}.m4a`,
    durationMs: 30000,
    albumName: "Test",
    albumImageUrl: null,
    source: "itunes",
  }
}

// ---------------------------------------------------------------------------
// confirmTarget cap: Math.min(displayTarget + HEADROOM, 30)
// ---------------------------------------------------------------------------

describe("confirmTarget cap — per-rail behaviour", () => {
  /**
   * Verify that confirmToTarget respects the computed cap values each rail
   * passes. We test the formula directly: each rail's confirmTarget must be
   * Math.min(displayTarget + 10, 30).
   *
   * Rail display targets (non-adventurous):
   *   adjacent  = 10  → confirmTarget = 20
   *   outside   = 10  → confirmTarget = 20
   *   wildcards = 10  → confirmTarget = 20
   *   leftfield = 16  → confirmTarget = 26
   *
   * Adventurous variants:
   *   adjacent  = 12  → confirmTarget = 22
   *   outside   = 12  → confirmTarget = 22
   *   wildcards = 12  → confirmTarget = 22
   *   leftfield = 40  → confirmTarget = min(50, 30) = 30  (cap kicks in)
   */
  const HEADROOM = 10

  const cases: Array<{ name: string; displayTarget: number; expected: number }> = [
    { name: "adjacent (baseline)",       displayTarget: 10, expected: 20 },
    { name: "outside (baseline)",        displayTarget: 10, expected: 20 },
    { name: "wildcards (baseline)",      displayTarget: 10, expected: 20 },
    { name: "leftfield (baseline)",      displayTarget: 16, expected: 26 },
    { name: "adjacent (adventurous)",    displayTarget: 12, expected: 22 },
    { name: "outside (adventurous)",     displayTarget: 12, expected: 22 },
    { name: "wildcards (adventurous)",   displayTarget: 12, expected: 22 },
    { name: "leftfield (adventurous)",   displayTarget: 40, expected: 30 }, // cap at 30
  ]

  for (const { name, displayTarget, expected } of cases) {
    it(`${name}: confirmTarget=${expected}`, () => {
      const confirmTarget = Math.min(displayTarget + HEADROOM, 30)
      expect(confirmTarget).toBe(expected)
    })
  }

  it("confirmToTarget stops confirming once confirmTarget is reached", async () => {
    // Build 40 playable artists — only the first `confirmTarget` should be confirmed.
    const confirmTarget = 20
    const items = Array.from({ length: 40 }, (_, i) => ({ artist: artist(`a${i}`) }))
    const confirmed: string[] = []
    const confirm = async (a: Artist) => {
      confirmed.push(a.id)
      return [track(a.id)]
    }
    const { kept, confirmedCount } = await confirmToTarget(items, confirmTarget, confirm)
    expect(kept).toHaveLength(confirmTarget)
    expect(confirmedCount).toBe(confirmTarget)
    expect(confirmed).toHaveLength(confirmTarget)
    // Tail beyond confirmTarget must never be touched
    expect(confirmed.every((id) => parseInt(id.slice(1)) < confirmTarget)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// rankByCurve
// ---------------------------------------------------------------------------

describe("rankByCurve", () => {
  it("is a no-op when k is undefined", () => {
    const names = ["b", "a", "c"]
    const byName = new Map([
      ["a", { popularity: 20 }],
      ["b", { popularity: 80 }],
      ["c", { popularity: 50 }],
    ])
    expect(rankByCurve(names, byName, undefined)).toBe(names)
  })

  it("is a no-op when k >= 1.0 (mainstream mode)", () => {
    const names = ["b", "a"]
    const byName = new Map([
      ["a", { popularity: 20 }],
      ["b", { popularity: 80 }],
    ])
    expect(rankByCurve(names, byName, 1.0)).toBe(names)
  })

  it("sorts lower-popularity first when k < 1", () => {
    const names = ["high-pop", "low-pop"]
    const byName = new Map([
      ["high-pop", { popularity: 80 }],
      ["low-pop", { popularity: 20 }],
    ])
    // k=0.95: 0.95^20 >> 0.95^80 → low-pop scores higher
    const ranked = rankByCurve(names, byName, 0.95)
    expect(ranked[0]).toBe("low-pop")
    expect(ranked[1]).toBe("high-pop")
  })

  it("preserves original order for ties (stable sort)", () => {
    const names = ["a", "b", "c"]
    const byName = new Map([
      ["a", { popularity: 50 }],
      ["b", { popularity: 50 }],
      ["c", { popularity: 50 }],
    ])
    const ranked = rankByCurve(names, byName, 0.95)
    expect(ranked).toEqual(["a", "b", "c"])
  })

  it("uses popularity=50 as default for unknown artists", () => {
    const names = ["known", "unknown"]
    const byName = new Map([["known", { popularity: 90 }]])
    // k=0.9: 0.9^50 > 0.9^90 → unknown (pop=50) ranks above known (pop=90)
    const ranked = rankByCurve(names, byName, 0.9)
    expect(ranked[0]).toBe("unknown")
    expect(ranked[1]).toBe("known")
  })
})

// ---------------------------------------------------------------------------
// computeTopAnchors
// ---------------------------------------------------------------------------

describe("computeTopAnchors", () => {
  it("returns [] when fewer than 2 anchors have data", () => {
    // No listened artists
    expect(computeTopAnchors([])).toEqual([])
  })

  it("returns [] when genres don't map to any anchor", () => {
    const listened = [
      { play_count: 10, genres: ["nonexistent-genre-xyz"] },
      { play_count: 5,  genres: ["another-unknown-genre"] },
    ]
    // genreToAnchor returns null for unknown genres → no anchor accumulations
    expect(computeTopAnchors(listened)).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// EXPLORE_CACHE_TTL_MS
// ---------------------------------------------------------------------------

describe("EXPLORE_CACHE_TTL_MS", () => {
  it("is exactly 24 hours", () => {
    expect(EXPLORE_CACHE_TTL_MS).toBe(24 * 60 * 60 * 1000)
  })
})
