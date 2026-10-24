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

const itunesHit = () => ({
  ok: true,
  data: { results: [{ artistId: 657515, artistName: "Radiohead", artistLinkUrl: ITUNES_URL }] },
})

async function run(tables: Tables) {
  const fake = createFakeSupabase(tables)
  const url = await linkFor(fake.client, { id: ID, name: "Radiohead" }, "apple_music", NOW)
  return { url, tables: fake.tables }
}

beforeEach(() => {
  itunesFetch.mockReset()
  itunesFetch.mockResolvedValue(itunesHit())
  vi.spyOn(console, "log").mockImplementation(() => {})
  vi.spyOn(console, "error").mockImplementation(() => {})
})

describe("linkFor apple_music precedence", () => {
  it("1. a validated artists.apple_id wins over everything (no iTunes call)", async () => {
    const { url } = await run({
      artists: [{ id: ID, apple_id: "657515" }],
      artist_external_links: [{ artist_id: ID, apple_music_url: "https://music.apple.com/x", updated_at: FRESH }],
    })
    expect(url).toBe("https://music.apple.com/us/artist/657515")
    expect(itunesFetch).not.toHaveBeenCalled()
  })

  it("ignores a malformed apple_id and falls through", async () => {
    const { url } = await run({ artists: [{ id: ID, apple_id: "../evil" }] })
    expect(url).toBe(ITUNES_URL)
  })

  it("2. a fresh cached URL is used without a live lookup", async () => {
    const { url } = await run({
      artists: [{ id: ID, apple_id: null }],
      artist_external_links: [{ artist_id: ID, apple_music_url: "https://music.apple.com/us/artist/cached/1", updated_at: FRESH }],
    })
    expect(url).toBe("https://music.apple.com/us/artist/cached/1")
    expect(itunesFetch).not.toHaveBeenCalled()
  })

  it("2. a fresh negative cache (NULL) → search URL, no live lookup", async () => {
    const { url } = await run({ artist_external_links: [{ artist_id: ID, apple_music_url: null, updated_at: FRESH }] })
    expect(url).toBe(SEARCH)
    expect(itunesFetch).not.toHaveBeenCalled()
  })

  it("2. a fresh but unsafe cached URL → search URL", async () => {
    const { url } = await run({ artist_external_links: [{ artist_id: ID, apple_music_url: "https://evil.com/x", updated_at: FRESH }] })
    expect(url).toBe(SEARCH)
  })

  it("3. stale cache → live lookup, result cached", async () => {
    const { url, tables } = await run({ artist_external_links: [{ artist_id: ID, apple_music_url: null, updated_at: STALE }] })
    expect(url).toBe(ITUNES_URL)
    expect(tables.artist_external_links).toEqual([
      { artist_id: ID, apple_music_url: ITUNES_URL, updated_at: new Date(NOW).toISOString() },
    ])
  })

  it("4. live miss (name mismatch) → search URL and negative cache", async () => {
    itunesFetch.mockResolvedValue({
      ok: true,
      data: { results: [{ artistId: 1, artistName: "Radiohead Tribute", artistLinkUrl: ITUNES_URL }] },
    })
    const { url, tables } = await run({})
    expect(url).toBe(SEARCH)
    expect(tables.artist_external_links[0].apple_music_url).toBeNull()
  })

  it("4. breaker open → search URL and NOT negatively cached", async () => {
    itunesFetch.mockResolvedValue({ ok: false, reason: "breaker" })
    const { url, tables } = await run({})
    expect(url).toBe(SEARCH)
    expect(tables.artist_external_links ?? []).toEqual([])
  })

  it("4. iTunes HTTP failure → search URL (negatively cached, as before)", async () => {
    itunesFetch.mockResolvedValue({ ok: false, reason: "http", status: 500 })
    const { url, tables } = await run({})
    expect(url).toBe(SEARCH)
    expect(tables.artist_external_links).toHaveLength(1)
  })
})
