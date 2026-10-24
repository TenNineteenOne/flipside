import { describe, it, expect, vi, beforeEach } from "vitest"
import { createFakeSupabase, type Tables } from "@/lib/recommendation/__fixtures__/fake-supabase"

const itunesFetch = vi.fn()
vi.mock("@/lib/music-provider/itunes", () => ({ itunesFetch: (...a: unknown[]) => itunesFetch(...a) }))

import { linkFor } from "./external-links"

const ID = "11111111-1111-4111-8111-111111111111"
const NOW = Date.parse("2026-10-24T00:00:00.000Z")
const FRESH = "2026-10-20T00:00:00.000Z"
const STALE = "2026-08-01T00:00:00.000Z"
const ITUNES_URL = "https://music.apple.com/us/artist/radiohead/657515?uo=4"
const SEARCH = "https://music.apple.com/search?term=Radiohead"
const ARTIST = { id: ID, name: "Radiohead", apple_id: null }

const itunesHit = () => ({
  ok: true,
  data: { results: [{ artistId: 657515, artistName: "Radiohead", artistLinkUrl: ITUNES_URL }] },
})

async function run(tables: Tables) {
  const fake = createFakeSupabase({ artists: [ARTIST], ...tables })
  const url = await linkFor(fake.client, ID, "apple_music", NOW)
  return { url, tables: fake.tables }
}

beforeEach(() => {
  itunesFetch.mockReset()
  itunesFetch.mockResolvedValue(itunesHit())
  vi.spyOn(console, "log").mockImplementation(() => {})
  vi.spyOn(console, "error").mockImplementation(() => {})
})

describe("linkFor apple_music precedence", () => {
  it("unknown artist id → null (route 404s), no iTunes call", async () => {
    const { url } = await run({ artists: [] })
    expect(url).toBeNull()
    expect(itunesFetch).not.toHaveBeenCalled()
  })

  it("does NOT trust artists.apple_id (MB name search can pick a homonym)", async () => {
    const { url } = await run({ artists: [{ ...ARTIST, apple_id: "999" }] })
    expect(url).toBe(ITUNES_URL)
  })

  it("looks up and checks equality with the artists row name, gate-only", async () => {
    await run({})
    expect(itunesFetch).toHaveBeenCalledWith(
      expect.stringContaining("term=Radiohead&"),
      5000,
      { gateOnly: true },
    )
  })

  it("1. a fresh cached URL is used without a live lookup", async () => {
    const { url } = await run({
      artist_external_links: [{ artist_id: ID, apple_music_url: "https://music.apple.com/us/artist/cached/1", updated_at: FRESH }],
    })
    expect(url).toBe("https://music.apple.com/us/artist/cached/1")
    expect(itunesFetch).not.toHaveBeenCalled()
  })

  it("1. a fresh negative cache (NULL) → search URL by row name, no live lookup", async () => {
    const { url } = await run({ artist_external_links: [{ artist_id: ID, apple_music_url: null, updated_at: FRESH }] })
    expect(url).toBe(SEARCH)
    expect(itunesFetch).not.toHaveBeenCalled()
  })

  it("1. a fresh but unsafe cached URL → search URL", async () => {
    const { url } = await run({ artist_external_links: [{ artist_id: ID, apple_music_url: "https://evil.com/x", updated_at: FRESH }] })
    expect(url).toBe(SEARCH)
  })

  it("2. stale cache → live lookup, result cached", async () => {
    const { url, tables } = await run({ artist_external_links: [{ artist_id: ID, apple_music_url: null, updated_at: STALE }] })
    expect(url).toBe(ITUNES_URL)
    expect(tables.artist_external_links).toEqual([
      { artist_id: ID, apple_music_url: ITUNES_URL, updated_at: new Date(NOW).toISOString() },
    ])
  })

  it("3. live miss (name mismatch) → search URL and negative cache", async () => {
    itunesFetch.mockResolvedValue({
      ok: true,
      data: { results: [{ artistId: 1, artistName: "Radiohead Tribute", artistLinkUrl: ITUNES_URL }] },
    })
    const { url, tables } = await run({})
    expect(url).toBe(SEARCH)
    expect(tables.artist_external_links[0].apple_music_url).toBeNull()
  })

  it("3. iTunes HTTP failure → search URL (negatively cached, as baseline)", async () => {
    itunesFetch.mockResolvedValue({ ok: false, reason: "http", status: 500 })
    const { url, tables } = await run({})
    expect(url).toBe(SEARCH)
    expect(tables.artist_external_links).toHaveLength(1)
  })
})
