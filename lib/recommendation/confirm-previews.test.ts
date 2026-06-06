import { describe, it, expect } from "vitest"
import {
  playableTracks,
  confirmPlayableTracks,
  type ConfirmPreviewDeps,
  type ConfirmInput,
} from "./confirm-previews"
import type { Track } from "@/lib/music-provider/types"

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
