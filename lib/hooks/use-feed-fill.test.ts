import { describe, it, expect } from "vitest"
import { isPlayable, selectNewPlayable, type FeedRec } from "./use-feed-fill"

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function rec(id: string, previewUrl: string | null | undefined): FeedRec {
  const topTracks =
    previewUrl === undefined
      ? undefined
      : [{ previewUrl }]
  return {
    spotify_artist_id: id,
    artist_data: { topTracks },
  }
}

function playableRec(id: string): FeedRec {
  return rec(id, "https://audio.example.com/track.m4a")
}

function unplayableRec(id: string): FeedRec {
  return rec(id, null)
}

function noTracksRec(id: string): FeedRec {
  return { spotify_artist_id: id, artist_data: {} }
}

// ---------------------------------------------------------------------------
// isPlayable
// ---------------------------------------------------------------------------

describe("isPlayable", () => {
  it("is true when at least one track has a non-empty previewUrl", () => {
    expect(isPlayable(playableRec("a"))).toBe(true)
  })

  it("is false when all tracks have null previewUrl", () => {
    expect(isPlayable(unplayableRec("a"))).toBe(false)
  })

  it("is false when all tracks have empty-string previewUrl", () => {
    const r = rec("a", "")
    expect(isPlayable(r)).toBe(false)
  })

  it("is false when topTracks is undefined", () => {
    expect(isPlayable(noTracksRec("a"))).toBe(false)
  })

  it("is false when topTracks is an empty array", () => {
    const r: FeedRec = { spotify_artist_id: "a", artist_data: { topTracks: [] } }
    expect(isPlayable(r)).toBe(false)
  })

  it("is true when mixed tracks include at least one playable", () => {
    const r: FeedRec = {
      spotify_artist_id: "a",
      artist_data: {
        topTracks: [{ previewUrl: null }, { previewUrl: "https://audio.example.com/t.m4a" }],
      },
    }
    expect(isPlayable(r)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// selectNewPlayable
// ---------------------------------------------------------------------------

describe("selectNewPlayable", () => {
  it("returns playable recs not in seenIds", () => {
    const seen = new Set(["a"])
    const fetched = [playableRec("a"), playableRec("b"), playableRec("c")]
    const result = selectNewPlayable(seen, fetched)
    expect(result.map((r) => r.spotify_artist_id)).toEqual(["b", "c"])
  })

  it("excludes unplayable recs even if not in seenIds", () => {
    const seen = new Set<string>()
    const fetched = [playableRec("a"), unplayableRec("b"), noTracksRec("c")]
    const result = selectNewPlayable(seen, fetched)
    expect(result.map((r) => r.spotify_artist_id)).toEqual(["a"])
  })

  it("excludes recs already in seenIds regardless of playability", () => {
    const seen = new Set(["a", "b"])
    const fetched = [playableRec("a"), playableRec("b"), playableRec("c")]
    const result = selectNewPlayable(seen, fetched)
    expect(result.map((r) => r.spotify_artist_id)).toEqual(["c"])
  })

  it("returns empty array when all are seen", () => {
    const seen = new Set(["a", "b"])
    const fetched = [playableRec("a"), playableRec("b")]
    expect(selectNewPlayable(seen, fetched)).toHaveLength(0)
  })

  it("returns empty array when all are unplayable", () => {
    const seen = new Set<string>()
    const fetched = [unplayableRec("a"), unplayableRec("b")]
    expect(selectNewPlayable(seen, fetched)).toHaveLength(0)
  })

  it("returns empty array for empty fetched input", () => {
    const seen = new Set(["a"])
    expect(selectNewPlayable(seen, [])).toHaveLength(0)
  })

  it("preserves order of fetched recs", () => {
    const seen = new Set<string>()
    const fetched = [playableRec("c"), playableRec("a"), playableRec("b")]
    const result = selectNewPlayable(seen, fetched)
    expect(result.map((r) => r.spotify_artist_id)).toEqual(["c", "a", "b"])
  })

  it("handles idle scenario: all fetched recs already seen", () => {
    const seen = new Set(["x", "y", "z"])
    const fetched = [playableRec("x"), playableRec("y"), playableRec("z")]
    // Simulates a poll where server returned same 3 recs — idle, nothing new.
    expect(selectNewPlayable(seen, fetched)).toHaveLength(0)
  })
})
