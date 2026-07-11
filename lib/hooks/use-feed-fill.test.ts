import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { isPlayable, selectNewPlayable, createFeedFillController, type FeedRec } from "./use-feed-fill"

const POLL_INTERVAL_MS = 2500

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function rec(id: string, previewUrl: string | null | undefined): FeedRec {
  const topTracks =
    previewUrl === undefined
      ? undefined
      : [{ previewUrl }]
  return {
    artist_id: id,
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
  return { artist_id: id, artist_data: {} }
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
    const r: FeedRec = { artist_id: "a", artist_data: { topTracks: [] } }
    expect(isPlayable(r)).toBe(false)
  })

  it("is true when mixed tracks include at least one playable", () => {
    const r: FeedRec = {
      artist_id: "a",
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
    expect(result.map((r) => r.artist_id)).toEqual(["b", "c"])
  })

  it("excludes unplayable recs even if not in seenIds", () => {
    const seen = new Set<string>()
    const fetched = [playableRec("a"), unplayableRec("b"), noTracksRec("c")]
    const result = selectNewPlayable(seen, fetched)
    expect(result.map((r) => r.artist_id)).toEqual(["a"])
  })

  it("excludes recs already in seenIds regardless of playability", () => {
    const seen = new Set(["a", "b"])
    const fetched = [playableRec("a"), playableRec("b"), playableRec("c")]
    const result = selectNewPlayable(seen, fetched)
    expect(result.map((r) => r.artist_id)).toEqual(["c"])
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
    expect(result.map((r) => r.artist_id)).toEqual(["c", "a", "b"])
  })

  it("handles idle scenario: all fetched recs already seen", () => {
    const seen = new Set(["x", "y", "z"])
    const fetched = [playableRec("x"), playableRec("y"), playableRec("z")]
    // Simulates a poll where server returned same 3 recs — idle, nothing new.
    expect(selectNewPlayable(seen, fetched)).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// createFeedFillController — restart()
// ---------------------------------------------------------------------------

// Queue-based fetch mock: each call to fetchImpl pops the next queued batch of
// recs (or an empty batch once the queue is drained, simulating an idle poll).
function makeQueuedFetch(batches: FeedRec[][]) {
  const queue = [...batches]
  const fetchImpl = vi.fn(async () => {
    const recommendations = queue.length > 0 ? queue.shift()! : []
    return {
      ok: true,
      json: async () => ({ recommendations }),
    } as unknown as Response
  })
  return fetchImpl
}

describe("createFeedFillController", () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("restart after idle-stop resumes appending", async () => {
    // targetCount=10, initialIds empty → auto-starts. First 3 polls return
    // nothing new, tripping the idle-stop (MAX_IDLE_POLLS=3).
    const fetchImpl = makeQueuedFetch([[], [], []])
    const onAppend = vi.fn()
    const controller = createFeedFillController<FeedRec>({
      initialIds: [],
      targetCount: 10,
      onAppend,
      fetchImpl,
    })

    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 3)
    expect(onAppend).not.toHaveBeenCalled()
    expect(fetchImpl).toHaveBeenCalledTimes(3) // idle-stopped

    // Confirms the idle-stop actually cleared the interval: no further polls
    // until restart() is called.
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 2)
    expect(fetchImpl).toHaveBeenCalledTimes(3)

    fetchImpl.mockImplementationOnce(async () => ({
      ok: true,
      json: async () => ({ recommendations: [playableRec("a")] }),
    }) as unknown as Promise<Response>)

    controller.restart()
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS)

    expect(onAppend).toHaveBeenCalledTimes(1)
    expect(onAppend.mock.calls[0][0].map((r: FeedRec) => r.artist_id)).toEqual(["a"])
  })

  it("restart begins polling when the controller never auto-started", async () => {
    // initialIds.length (2) >= targetCount (2) → never auto-starts.
    const fetchImpl = makeQueuedFetch([[playableRec("c")]])
    const onAppend = vi.fn()
    const controller = createFeedFillController<FeedRec>({
      initialIds: ["a", "b"],
      targetCount: 2,
      onAppend,
      fetchImpl,
    })

    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 2)
    expect(fetchImpl).not.toHaveBeenCalled()
    expect(onAppend).not.toHaveBeenCalled()

    controller.restart()
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS)

    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(onAppend).toHaveBeenCalledTimes(1)
    expect(onAppend.mock.calls[0][0].map((r: FeedRec) => r.artist_id)).toEqual(["c"])
  })

  it("restart extends the target past the original targetCount", async () => {
    // targetCount=2: reaches target after two 1-rec appends and stops.
    const fetchImpl = makeQueuedFetch([[playableRec("a")], [playableRec("b")]])
    const onAppend = vi.fn()
    const controller = createFeedFillController<FeedRec>({
      initialIds: [],
      targetCount: 2,
      onAppend,
      fetchImpl,
    })

    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 2)
    expect(onAppend).toHaveBeenCalledTimes(2) // shownCount now 2, target reached — stopped

    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 2)
    expect(fetchImpl).toHaveBeenCalledTimes(2) // confirms it stayed stopped at the old target

    // Restart sets target = shownCount(2) + 20 = 22, so polling past the
    // original targetCount=2 must continue appending instead of stopping.
    fetchImpl.mockImplementationOnce(async () => ({
      ok: true,
      json: async () => ({ recommendations: [playableRec("c")] }),
    }) as unknown as Promise<Response>)

    controller.restart()
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS)

    expect(onAppend).toHaveBeenCalledTimes(3)
    expect(onAppend.mock.calls[2][0].map((r: FeedRec) => r.artist_id)).toEqual(["c"])
  })
})
