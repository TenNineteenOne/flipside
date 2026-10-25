/**
 * The Last.fm adapter, tested through its interface with a fake fetch, an
 * in-memory cache store and an instrumented gate — no network, no Supabase.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import {
  createLastfm,
  filterGenreTags,
  mapSearchResponse,
  scaleListeners,
  type CacheStore,
  type LastfmDeps,
} from "./index"
import { resetCalls, snapshotCalls } from "@/lib/metrics/api-call-counter"

function memStore(): CacheStore & { rows: Map<string, { payload: unknown; fetched_at: string }> } {
  const rows = new Map<string, { payload: unknown; fetched_at: string }>()
  return {
    rows,
    async read(kind, key) { return rows.get(`${kind}:${key}`) ?? null },
    async write(kind, key, payload) { rows.set(`${kind}:${key}`, { payload, fetched_at: new Date().toISOString() }) },
  }
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })

/** Fake fetch answering from a queue; records every URL + init. */
function fakeFetch(...responses: Array<Response | Error>) {
  const calls: Array<{ url: string; init?: RequestInit }> = []
  const fn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init })
    const next = responses.shift()
    if (!next) throw new Error("fakeFetch: no response queued")
    if (next instanceof Error) throw next
    return next
  }) as typeof fetch
  return { fn, calls }
}

/** Unique keys per test so the module-level in-flight maps never collide. */
let n = 0
const uniq = (s: string) => `${s}-${++n}`

function make(fetchFn: typeof fetch, extra: Partial<LastfmDeps> = {}) {
  const cache = memStore()
  const lf = createLastfm({ apiKey: () => "k", fetch: fetchFn, cache, ...extra })
  return { lf, cache }
}

beforeEach(() => {
  resetCalls()
  vi.restoreAllMocks()
})

describe("key missing", () => {
  it("every read op degrades without a request; user sync throws", async () => {
    const { fn, calls } = fakeFetch()
    const cache = memStore()
    const lf = createLastfm({ apiKey: () => undefined, fetch: fn, cache })
    vi.spyOn(console, "warn").mockImplementation(() => {})

    expect(lf.hasKey()).toBe(false)
    expect(await lf.artistInfo(uniq("a"))).toBeNull()
    expect(await lf.similarArtists(uniq("a"))).toEqual([])
    expect(await lf.tagTopArtists(uniq("t"), 10)).toEqual([])
    expect(await lf.searchArtists(uniq("q"))).toEqual([])
    await expect(lf.userArtistNames("u")).rejects.toThrow("Last.fm API key is not configured")
    expect(calls).toHaveLength(0)
    // getInfo short-circuits before the cache; tag/search negative-cache the empty (pre-#175 behavior).
    expect([...cache.rows.keys()].some((k) => k.startsWith("getInfo:"))).toBe(false)
  })

  it("warns about the missing key once per adapter", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    const lf = createLastfm({ apiKey: () => "", fetch: fakeFetch().fn, cache: memStore() })
    await lf.similarArtists(uniq("a"))
    await lf.similarArtists(uniq("b"))
    expect(warn).toHaveBeenCalledOnce()
  })
})

describe("timeout", () => {
  it("passes each endpoint's AbortSignal timeout to fetch", async () => {
    const spy = vi.spyOn(AbortSignal, "timeout")
    const { fn } = fakeFetch(json({ similarartists: { artist: [{ name: "A" }] } }), json({ artist: {} }))
    const { lf } = make(fn)
    await lf.similarArtists(uniq("s"))
    await lf.artistInfo(uniq("i"))
    expect(spy.mock.calls.map((c) => c[0])).toEqual([8000, 6000])
  })

  it("a timed-out getInfo is transient: null and NOT cached", async () => {
    const abort = new DOMException("timed out", "TimeoutError")
    const { fn } = fakeFetch(abort)
    const { lf, cache } = make(fn)
    expect(await lf.artistInfo(uniq("x"))).toBeNull()
    expect(cache.rows.size).toBe(0)
  })

  it("a timed-out getSimilar logs and returns []", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {})
    const { fn } = fakeFetch(new DOMException("aborted", "AbortError"))
    const { lf } = make(fn)
    expect(await lf.similarArtists(uniq("x"))).toEqual([])
    expect(err.mock.calls[0][0]).toContain("timed out after 8s")
  })
})

describe("gate + counters", () => {
  it("routes every live call through the gate and counts it per endpoint", async () => {
    let gated = 0
    const limiter = { run: <T,>(f: () => Promise<T>) => { gated++; return f() } }
    const { fn } = fakeFetch(
      json({ topartists: { artist: [{ name: "T" }] } }),
      json({ similarartists: { artist: [{ name: "S" }] } }),
      json({ artist: {} }),
      json({ results: { artistmatches: { artist: [{ name: "Q" }] } } }),
      json({ topartists: { artist: [{ name: "U1" }] } }),
      json({ recenttracks: { track: { artist: { "#text": "U2" } } } }),
    )
    const { lf } = make(fn, { limiter })
    await lf.tagTopArtists(uniq("t"), 10)
    await lf.similarArtists(uniq("s"))
    await lf.artistInfo(uniq("i"))
    await lf.searchArtists(uniq("q"))
    expect(await lf.userArtistNames("me")).toEqual(["U1", "U2"])
    expect(gated).toBe(6)
    expect(snapshotCalls().lastfm).toEqual({ similar: 1, getInfo: 1, tag: 1, search: 1, user: 2, total: 6 })
  })
})

describe("cache read-through", () => {
  it("a second read is served from the cache: no fetch, no counter", async () => {
    const { fn, calls } = fakeFetch(json({ artist: { stats: { listeners: "500000" }, tags: { tag: [{ name: "Rock" }] } } }))
    const { lf } = make(fn)
    const name = uniq("Khruangbin")
    const first = await lf.artistInfo(name)
    const second = await lf.artistInfo(name)
    expect(second).toEqual(first)
    expect(calls).toHaveLength(1)
    expect(snapshotCalls().lastfm.getInfo).toBe(1)
  })

  it("getInfo: error 6 is negative-cached; non-6 errors and non-2xx are not", async () => {
    const { fn } = fakeFetch(json({ error: 6 }), json({ error: 29 }), json({}, 500))
    const { lf, cache } = make(fn)
    expect(await lf.artistInfo(uniq("gone"))).toBeNull()
    expect(cache.rows.size).toBe(1)
    expect(await lf.artistInfo(uniq("busy"))).toBeNull()
    expect(await lf.artistInfo(uniq("down"))).toBeNull()
    expect(cache.rows.size).toBe(1)
  })

  it("getInfo parses listeners + filtered tags; tolerates missing fields", async () => {
    const { fn } = fakeFetch(
      json({ artist: { stats: { listeners: "500000" }, tags: { tag: [{ name: "Psychedelic Rock" }, { name: "Indie Rock" }, { name: "seen live" }] } } }),
      json({ artist: {} }),
    )
    const { lf } = make(fn)
    const r = await lf.artistInfo(uniq("k"))
    expect(r!.genres).toEqual(["psychedelic rock", "indie rock"])
    expect(r!.popularity).toBeGreaterThan(40)
    expect(r!.popularity).toBeLessThan(70)
    expect(await lf.artistInfo(uniq("bare"))).toEqual({ genres: [], popularity: 0 })
  })

  it("getInfo request is byte-identical (URLSearchParams order + autocorrect)", async () => {
    const { fn, calls } = fakeFetch(json({ artist: {} }))
    const { lf } = make(fn)
    await lf.artistInfo("Sigur Rós x")
    expect(calls[0].url).toBe(
      "https://ws.audioscrobbler.com/2.0?method=artist.getInfo&artist=Sigur+R%C3%B3s+x&autocorrect=1&api_key=k&format=json",
    )
  })

  it("search: blank query short-circuits; results cached under query:limit", async () => {
    const { fn, calls } = fakeFetch(json({ results: { artistmatches: { artist: [{ name: "Boards of Canada" }] } } }))
    const { lf, cache } = make(fn)
    expect(await lf.searchArtists("   ")).toEqual([])
    const q = uniq("boc")
    expect((await lf.searchArtists(` ${q} `)).map((c) => c.name)).toEqual(["Boards of Canada"])
    expect(calls[0].url).toBe(
      `https://ws.audioscrobbler.com/2.0/?method=artist.search&artist=${q}&api_key=k&format=json&limit=10`,
    )
    expect(cache.rows.has(`search:${q}:10`)).toBe(true)
  })

  it("similar: empty results are not cached", async () => {
    const { fn } = fakeFetch(json({ similarartists: { artist: [] } }))
    const { lf, cache } = make(fn)
    expect(await lf.similarArtists(uniq("x"))).toEqual([])
    expect(cache.rows.size).toBe(0)
  })
})

describe("similarArtists shape and ranking", () => {
  const body = (items: Array<{ name: string; match?: string }>) => json({ similarartists: { artist: items } })

  it("returns the full ordered list (tail-bias is done in the engine)", async () => {
    const items = Array.from({ length: 50 }, (_, i) => ({ name: `Artist ${i}`, match: (1 - i * 0.02).toFixed(2) }))
    const { fn, calls } = fakeFetch(body(items))
    const { lf } = make(fn)
    const result = await lf.similarArtists("Seed X")
    expect(result).toHaveLength(50)
    expect(result[0].name).toBe("Artist 0")
    expect(result[49].name).toBe("Artist 49")
    expect(calls[0].url).toBe(
      "https://ws.audioscrobbler.com/2.0/?method=artist.getSimilar&artist=Seed%20X&api_key=k&format=json&limit=50",
    )
  })

  it("parses match as a float regardless of string/number encoding", async () => {
    const { fn } = fakeFetch(body([{ name: "A", match: "0.95" }, { name: "B", match: "0.5" }, { name: "C" }]))
    const { lf } = make(fn)
    const result = await lf.similarArtists(uniq("Seed"))
    expect(result).toEqual([{ name: "A", match: 0.95 }, { name: "B", match: 0.5 }, { name: "C", match: 0 }])
  })

  it("returns [] on a Last.fm error body or a non-200", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {})
    const { fn } = fakeFetch(json({ error: 6 }), new Response("", { status: 500 }))
    const { lf } = make(fn)
    expect(await lf.similarArtists(uniq("Nope"))).toEqual([])
    expect(await lf.similarArtists(uniq("Seed"))).toEqual([])
  })
})

describe("tagTopArtists hyphen→space retry", () => {
  // Genre-tree leaf tags are hyphenated slugs but Last.fm indexes most
  // multi-word tags space-separated ("dutch black metal" → 267 vs 0).
  const tags = (names: string[]) => json({ topartists: { artist: names.map((name) => ({ name })) } })

  it("returns the as-is result without retrying when the tag has artists", async () => {
    const { fn, calls } = fakeFetch(tags(["Massive Attack", "Portishead"]))
    const { lf } = make(fn)
    expect(await lf.tagTopArtists("trip-hop", 30)).toEqual(["Massive Attack", "Portishead"])
    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe(
      "https://ws.audioscrobbler.com/2.0/?method=tag.gettopartists&tag=trip-hop&api_key=k&format=json&limit=30",
    )
  })

  it("retries a hyphenated tag with spaces when the as-is form is empty", async () => {
    const { fn, calls } = fakeFetch(tags([]), tags(["Helleruin", "Sammath"]))
    const { lf } = make(fn)
    expect(await lf.tagTopArtists("dutch-black-metal", 30)).toEqual(["Helleruin", "Sammath"])
    expect(calls[1].url).toContain("tag=dutch%20black%20metal")
  })

  it("does not retry a single-word empty tag; negative-caches the empty", async () => {
    const { fn, calls } = fakeFetch(tags([]))
    const { lf, cache } = make(fn)
    expect(await lf.tagTopArtists("zzznotarealtag", 30)).toEqual([])
    expect(calls).toHaveLength(1)
    expect(cache.rows.get("tag_top:zzznotarealtag:30")?.payload).toEqual([])
  })

  it("a transient failure of the primary spelling returns [] and is NOT cached", async () => {
    const { fn } = fakeFetch(new Response("rate limited", { status: 429 }))
    const { lf, cache } = make(fn)
    expect(await lf.tagTopArtists("post-punk", 30)).toEqual([])
    expect(cache.rows.size).toBe(0)
  })

  it("a transient retry failure does not mask a genuinely-empty primary result", async () => {
    const { fn } = fakeFetch(tags([]), new Response("server error", { status: 500 }))
    const { lf, cache } = make(fn)
    expect(await lf.tagTopArtists("flaky-genre", 30)).toEqual([])
    expect(cache.rows.get("tag_top:flaky-genre:30")?.payload).toEqual([])
  })
})

describe("userArtistNames", () => {
  it("throws on a non-2xx or a Last.fm error body", async () => {
    const a = make(fakeFetch(json({}, 500), json({})).fn)
    await expect(a.lf.userArtistNames("u")).rejects.toThrow("HTTP 500")
    const b = make(fakeFetch(json({ error: 6, message: "User not found" }), json({})).fn)
    await expect(b.lf.userArtistNames("u")).rejects.toThrow("User not found")
  })
})


/** Build a raw Last.fm artist.search body (the shape confirmed against the live API). */
function body(artists: unknown) {
  return { results: { artistmatches: { artist: artists } } }
}

function rawArtist(name: string, extra: Record<string, unknown> = {}) {
  return { name, listeners: "1000", mbid: "mb-" + name, url: "u", streamable: "0", ...extra }
}


describe("mapSearchResponse", () => {
  it("maps an array of matches to candidates", () => {
    const out = mapSearchResponse(
      body([
        rawArtist("Boards of Canada", {
          listeners: "2114719",
          mbid: "69158f97-4c07-4c4e-baf8-4e4ab1ed666e",
          image: [
            { "#text": "small.png", size: "small" },
            { "#text": "xl.png", size: "extralarge" },
          ],
        }),
        rawArtist("Bibio"),
      ]),
    )
    expect(out).toHaveLength(2)
    expect(out[0]).toEqual({
      name: "Boards of Canada",
      mbid: "69158f97-4c07-4c4e-baf8-4e4ab1ed666e",
      listeners: 2114719,
      imageUrl: "xl.png", // prefers extralarge over small
    })
    expect(out[1].name).toBe("Bibio")
  })

  it("handles the single-result-as-object quirk (not an array)", () => {
    const out = mapSearchResponse(body(rawArtist("Radiohead")))
    expect(out).toHaveLength(1)
    expect(out[0].name).toBe("Radiohead")
  })

  it("returns [] for empty results, missing artistmatches, and malformed bodies", () => {
    expect(mapSearchResponse(body([]))).toEqual([])
    expect(mapSearchResponse({ results: {} })).toEqual([])
    expect(mapSearchResponse({})).toEqual([])
    expect(mapSearchResponse(null)).toEqual([])
    expect(mapSearchResponse("nonsense")).toEqual([])
  })

  it("nulls a missing/empty mbid and defaults non-numeric listeners to 0", () => {
    const out = mapSearchResponse(
      body([
        { name: "No MBID", listeners: "not-a-number" },
        { name: "Empty MBID", mbid: "", listeners: "5" },
      ]),
    )
    expect(out[0]).toMatchObject({ name: "No MBID", mbid: null, listeners: 0 })
    expect(out[1]).toMatchObject({ name: "Empty MBID", mbid: null, listeners: 5 })
  })

  it("drops entries with no usable name and picks the largest available image", () => {
    const out = mapSearchResponse(
      body([
        { listeners: "1" }, // no name → dropped
        rawArtist("Only Small", { image: [{ "#text": "s.png", size: "small" }] }),
        rawArtist("No Images", { image: [] }),
        rawArtist("Blank Images", { image: [{ "#text": "", size: "large" }] }),
      ]),
    )
    expect(out.map((c) => c.name)).toEqual(["Only Small", "No Images", "Blank Images"])
    expect(out[0].imageUrl).toBe("s.png") // falls back to the only size present
    expect(out[1].imageUrl).toBeNull()
    expect(out[2].imageUrl).toBeNull() // blank #text is not a usable URL
  })
})

describe("scaleListeners", () => {
  it("returns 0 for zero or negative listener counts", () => {
    expect(scaleListeners(0)).toBe(0)
    expect(scaleListeners(-100)).toBe(0)
  })

  it("calibrates 10K ≈ 30, 1M ≈ 60, 100M ≈ 90", () => {
    expect(scaleListeners(10_000)).toBeGreaterThanOrEqual(28)
    expect(scaleListeners(10_000)).toBeLessThanOrEqual(32)
    expect(scaleListeners(1_000_000)).toBeGreaterThanOrEqual(58)
    expect(scaleListeners(1_000_000)).toBeLessThanOrEqual(62)
    expect(scaleListeners(100_000_000)).toBeGreaterThanOrEqual(88)
    expect(scaleListeners(100_000_000)).toBeLessThanOrEqual(92)
  })

  it("clamps to 0-100 range", () => {
    expect(scaleListeners(1e15)).toBeLessThanOrEqual(100)
    expect(scaleListeners(1)).toBeGreaterThanOrEqual(0)
  })
})

describe("filterGenreTags", () => {
  it("drops non-genre noise tags", () => {
    expect(filterGenreTags(["seen live", "rock", "favorite"])).toEqual(["rock"])
  })

  it("drops era-style tags like 90s, 2000s, pre-1970s", () => {
    expect(filterGenreTags(["90s", "2000s", "pre-1970s", "indie rock"])).toEqual([
      "indie rock",
    ])
  })

  it("lowercases, trims, and de-spaces consistently", () => {
    expect(filterGenreTags(["  Rock  ", "Indie Pop"])).toEqual(["rock", "indie pop"])
  })

  it("caps at 5 tags", () => {
    const tags = ["a", "b", "c", "d", "e", "f", "g"]
    expect(filterGenreTags(tags)).toHaveLength(5)
  })

  it("drops empty strings", () => {
    expect(filterGenreTags(["", "  ", "rock"])).toEqual(["rock"])
  })
})
