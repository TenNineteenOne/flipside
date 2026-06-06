import { describe, it, expect } from "vitest"
import {
  playableTracks,
  hasPlayablePreview,
  confirmPlayableTracks,
  confirmToTarget,
  type ConfirmPreviewDeps,
  type ConfirmInput,
} from "./confirm-previews"
import type { Artist, Track } from "@/lib/music-provider/types"

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function track(id: string, previewUrl: string | null): Track {
  return {
    id,
    spotifyTrackId: null,
    name: `Track ${id}`,
    previewUrl,
    durationMs: 30000,
    albumName: "Test Album",
    albumImageUrl: null,
    source: "itunes",
  }
}

describe("hasPlayablePreview", () => {
  it("is false for undefined, null, or empty", () => {
    expect(hasPlayablePreview(undefined)).toBe(false)
    expect(hasPlayablePreview(null)).toBe(false)
    expect(hasPlayablePreview([])).toBe(false)
  })

  it("is false when every track lacks a preview URL", () => {
    expect(hasPlayablePreview([track("a", null), track("b", "")])).toBe(false)
  })

  it("is true when at least one track has a preview URL", () => {
    expect(hasPlayablePreview([track("a", null), track("b", "https://p/2")])).toBe(true)
  })

  it("works on the minimal { previewUrl } shape", () => {
    expect(hasPlayablePreview([{ previewUrl: "https://p/1" }])).toBe(true)
    expect(hasPlayablePreview([{ previewUrl: null }])).toBe(false)
  })
})

const withPreview = track("p1", "https://audio.example.com/p1.m4a")
const withPreview2 = track("p2", "https://audio.example.com/p2.m4a")
const nullPreview = track("n1", null)
const emptyPreview = track("e1", "")

function makeDeps(opts: {
  itunesResult?: Track[] | null
  itunesRejects?: boolean
  spotifyResult?: Track[]
  spotifyRejects?: boolean
} = {}): ConfirmPreviewDeps & { itunesCallCount: number; spotifyCallCount: number } {
  let itunesCallCount = 0
  let spotifyCallCount = 0
  return {
    get itunesCallCount() { return itunesCallCount },
    get spotifyCallCount() { return spotifyCallCount },
    searchItunes: async () => {
      itunesCallCount++
      if (opts.itunesRejects) throw new Error("iTunes unavailable")
      return opts.itunesResult ?? []
    },
    getSpotifyTopTracks: async () => {
      spotifyCallCount++
      if (opts.spotifyRejects) throw new Error("Spotify unavailable")
      return opts.spotifyResult ?? []
    },
  }
}

const baseArtist: ConfirmInput = { id: "artist-1", name: "Test Artist" }

// ---------------------------------------------------------------------------
// playableTracks
// ---------------------------------------------------------------------------

describe("playableTracks", () => {
  it("keeps tracks with a non-empty previewUrl", () => {
    const result = playableTracks([withPreview, withPreview2])
    expect(result).toHaveLength(2)
  })

  it("filters out tracks with null previewUrl", () => {
    const result = playableTracks([nullPreview])
    expect(result).toHaveLength(0)
  })

  it("filters out tracks with empty-string previewUrl", () => {
    const result = playableTracks([emptyPreview])
    expect(result).toHaveLength(0)
  })

  it("filters mixed list down to only playable tracks", () => {
    const result = playableTracks([withPreview, nullPreview, emptyPreview, withPreview2])
    expect(result).toHaveLength(2)
    expect(result.map((t) => t.id)).toEqual(["p1", "p2"])
  })

  it("returns empty array for empty input", () => {
    expect(playableTracks([])).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// confirmPlayableTracks — cache reuse
// ---------------------------------------------------------------------------

describe("confirmPlayableTracks — cache reuse", () => {
  it("topTracks present (non-empty) → returns playable subset, no dep calls", async () => {
    const deps = makeDeps()
    const artist: ConfirmInput = {
      ...baseArtist,
      topTracks: [withPreview, nullPreview],
    }
    const result = await confirmPlayableTracks(artist, deps)
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe("p1")
    expect(deps.itunesCallCount).toBe(0)
    expect(deps.spotifyCallCount).toBe(0)
  })

  it("topTracks === [] (negative cache) → returns [], no dep calls", async () => {
    const deps = makeDeps()
    const artist: ConfirmInput = { ...baseArtist, topTracks: [] }
    const result = await confirmPlayableTracks(artist, deps)
    expect(result).toHaveLength(0)
    expect(deps.itunesCallCount).toBe(0)
    expect(deps.spotifyCallCount).toBe(0)
  })

  it("topTracks with only non-playable tracks → returns [], no dep calls", async () => {
    const deps = makeDeps()
    const artist: ConfirmInput = {
      ...baseArtist,
      topTracks: [nullPreview, emptyPreview],
    }
    const result = await confirmPlayableTracks(artist, deps)
    expect(result).toHaveLength(0)
    expect(deps.itunesCallCount).toBe(0)
    expect(deps.spotifyCallCount).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// confirmPlayableTracks — iTunes-first
// ---------------------------------------------------------------------------

describe("confirmPlayableTracks — iTunes-first", () => {
  it("topTracks undefined, iTunes returns playable tracks → returns them; Spotify NOT called", async () => {
    const deps = makeDeps({ itunesResult: [withPreview, withPreview2] })
    const result = await confirmPlayableTracks(baseArtist, deps)
    expect(result).toHaveLength(2)
    expect(result.map((t) => t.id)).toEqual(["p1", "p2"])
    expect(deps.spotifyCallCount).toBe(0)
  })

  it("topTracks undefined, iTunes returns [] → falls back to Spotify", async () => {
    const deps = makeDeps({
      itunesResult: [],
      spotifyResult: [withPreview],
    })
    const result = await confirmPlayableTracks(baseArtist, deps)
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe("p1")
    expect(deps.itunesCallCount).toBe(1)
    expect(deps.spotifyCallCount).toBe(1)
  })

  it("topTracks undefined, iTunes returns null → falls back to Spotify", async () => {
    const deps = makeDeps({
      itunesResult: null,
      spotifyResult: [withPreview],
    })
    const result = await confirmPlayableTracks(baseArtist, deps)
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe("p1")
    expect(deps.itunesCallCount).toBe(1)
    expect(deps.spotifyCallCount).toBe(1)
  })

  it("topTracks undefined, iTunes returns only null-preview tracks → filtered out → falls back to Spotify", async () => {
    const deps = makeDeps({
      itunesResult: [nullPreview, emptyPreview],
      spotifyResult: [withPreview2],
    })
    const result = await confirmPlayableTracks(baseArtist, deps)
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe("p2")
    expect(deps.itunesCallCount).toBe(1)
    expect(deps.spotifyCallCount).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// confirmPlayableTracks — Spotify fallback
// ---------------------------------------------------------------------------

describe("confirmPlayableTracks — Spotify fallback", () => {
  it("both sources return empty → returns []", async () => {
    const deps = makeDeps({ itunesResult: [], spotifyResult: [] })
    const result = await confirmPlayableTracks(baseArtist, deps)
    expect(result).toHaveLength(0)
    expect(deps.itunesCallCount).toBe(1)
    expect(deps.spotifyCallCount).toBe(1)
  })

  it("both sources return null/empty → returns []", async () => {
    const deps = makeDeps({ itunesResult: null, spotifyResult: [] })
    const result = await confirmPlayableTracks(baseArtist, deps)
    expect(result).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// confirmPlayableTracks — error resilience
// ---------------------------------------------------------------------------

describe("confirmPlayableTracks — error resilience", () => {
  it("searchItunes rejects → treated as empty, falls back to Spotify, no throw", async () => {
    const deps = makeDeps({
      itunesRejects: true,
      spotifyResult: [withPreview],
    })
    await expect(confirmPlayableTracks(baseArtist, deps)).resolves.toHaveLength(1)
    expect(deps.spotifyCallCount).toBe(1)
  })

  it("getSpotifyTopTracks rejects and iTunes empty → returns [], no throw", async () => {
    const deps = makeDeps({
      itunesResult: [],
      spotifyRejects: true,
    })
    await expect(confirmPlayableTracks(baseArtist, deps)).resolves.toHaveLength(0)
  })

  it("both deps reject → returns [], no throw", async () => {
    const deps = makeDeps({ itunesRejects: true, spotifyRejects: true })
    await expect(confirmPlayableTracks(baseArtist, deps)).resolves.toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// confirmToTarget
// ---------------------------------------------------------------------------

function makeArtist(id: string): Artist {
  return { id, name: `Artist ${id}`, genres: [], imageUrl: null, popularity: 50 }
}

type Item = { artist: Artist; score: number }
function item(id: string, score = 0): Item {
  return { artist: makeArtist(id), score }
}

describe("confirmToTarget", () => {
  it("keeps only playable artists up to target", async () => {
    const items: Item[] = [item("a"), item("b"), item("c")]
    let confirmCount = 0
    const confirm = async (artist: Artist) => {
      confirmCount++
      // only "a" and "c" are playable
      if (artist.id === "b") return []
      return [track("t1", "https://audio.example.com/t1.m4a")]
    }
    const { kept } = await confirmToTarget(items, 2, confirm)
    expect(kept.map((k) => k.artist.id)).toEqual(["a", "c"])
    expect(confirmCount).toBe(3) // had to check all three to get 2 playable
  })

  it("stops confirming once target is reached (does not confirm tail)", async () => {
    const items: Item[] = [item("a"), item("b"), item("c"), item("d"), item("e")]
    const confirmed: string[] = []
    const confirm = async (artist: Artist) => {
      confirmed.push(artist.id)
      return [track("t1", "https://audio.example.com/t1.m4a")]
    }
    const { kept, confirmedCount } = await confirmToTarget(items, 2, confirm)
    expect(kept).toHaveLength(2)
    expect(confirmedCount).toBe(2) // stopped after 2 playable
    expect(confirmed).toEqual(["a", "b"]) // tail c/d/e never touched
  })

  it("preserves original order of kept items", async () => {
    // playable: a, c, e — all in score order
    const items: Item[] = [item("a", 5), item("b", 4), item("c", 3), item("d", 2), item("e", 1)]
    const confirm = async (artist: Artist) => {
      if (artist.id === "b" || artist.id === "d") return []
      return [track("t1", "https://audio.example.com/t1.m4a")]
    }
    const { kept } = await confirmToTarget(items, 3, confirm)
    expect(kept.map((k) => k.artist.id)).toEqual(["a", "c", "e"])
  })

  it("bakes topTracks onto the kept item (does not mutate original)", async () => {
    const a = item("a")
    expect(a.artist.topTracks).toBeUndefined()
    const playable = [track("t1", "https://audio.example.com/t1.m4a")]
    const confirm = async () => playable
    const { kept } = await confirmToTarget([a], 1, confirm)
    // The kept item's artist has topTracks set
    expect(kept[0].artist.topTracks).toEqual(playable)
    // The original item is not mutated
    expect(a.artist.topTracks).toBeUndefined()
  })

  it("empty input → empty kept, confirmedCount=0", async () => {
    let called = false
    const confirm = async () => { called = true; return [] }
    const { kept, confirmedCount } = await confirmToTarget([], 5, confirm)
    expect(kept).toHaveLength(0)
    expect(confirmedCount).toBe(0)
    expect(called).toBe(false)
  })

  it("confirm throws → artist is skipped, no throw bubbles", async () => {
    const items: Item[] = [item("a"), item("b")]
    const confirm = async (artist: Artist) => {
      if (artist.id === "a") throw new Error("boom")
      return [track("t1", "https://audio.example.com/t1.m4a")]
    }
    const { kept, confirmedCount } = await confirmToTarget(items, 2, confirm)
    // "a" was skipped (threw), "b" was kept
    expect(kept.map((k) => k.artist.id)).toEqual(["b"])
    expect(confirmedCount).toBe(2)
  })

  it("returns all playable when fewer than target are playable", async () => {
    const items: Item[] = [item("a"), item("b")]
    // only "a" is playable
    const confirm = async (artist: Artist) => {
      if (artist.id === "b") return []
      return [track("t1", "https://audio.example.com/t1.m4a")]
    }
    const { kept, confirmedCount } = await confirmToTarget(items, 5, confirm)
    expect(kept.map((k) => k.artist.id)).toEqual(["a"])
    expect(confirmedCount).toBe(2) // both checked, neither skipped early
  })
})
