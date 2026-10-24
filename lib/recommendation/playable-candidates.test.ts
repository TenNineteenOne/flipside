/**
 * PlayableCandidates — the shared resolve → gate → rehydrate → confirm →
 * persist pipeline (#175 D2), tested once with fakes: in-memory Supabase (the
 * doorway mints into `artists`, the preview store reads/writes
 * `artist_tracks_cache`) and fake Last.fm / iTunes / Spotify ports.
 */
import { describe, it, expect } from "vitest"
import { createFakeSupabase, type Row, type Tables } from "./__fixtures__/fake-supabase"
import { PlayableCandidates, type PlayablePorts } from "./playable-candidates"
import type { Artist, Track } from "@/lib/music-provider/types"

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

function artistsRow(id: string, name: string): Row {
  return { id, spotify_id: null, name, name_lower: name.toLowerCase(), genres: ["indie"], popularity: 30, image_url: null }
}

/** Fake ports. iTunes: default one playable track; `itunes` overrides per name (null = failure). */
function fakePorts(itunes: Record<string, Track[] | null> = {}) {
  const calls = { lookup: [] as string[], itunes: [] as string[] }
  const ports: PlayablePorts = {
    searchArtists: async (name) => {
      calls.lookup.push(name)
      return [{ id: "", spotifyId: null, name, genres: ["indie"], popularity: 30, imageUrl: null }]
    },
    searchItunes: async (name) => {
      calls.itunes.push(name)
      return name in itunes ? itunes[name] : [track(name)]
    },
    getSpotifyTopTracks: async () => [],
  }
  return { ports, calls }
}

function setup(tables: Tables = {}, itunes: Record<string, Track[] | null> = {}) {
  const fake = createFakeSupabase({ artists: [], artist_tracks_cache: [], ...tables })
  const { ports, calls } = fakePorts(itunes)
  return { fake, calls, pipeline: new PlayableCandidates(fake.client, ports) }
}

const BOC = "b0c00000-0000-4000-8000-000000000001"
const POS = "aaaaaaaa-0000-4000-8000-000000000001"
const NEG = "bbbbbbbb-0000-4000-8000-000000000002"
const fresh = () => new Date().toISOString()

describe("PlayableCandidates.playable (Explore one-shot)", () => {
  it("keys results by the INPUT name even when the roster row is spelled differently (Explore casing-drop regression)", async () => {
    const { pipeline } = setup({ artists: [artistsRow(BOC, "Boards of Canada")] })
    const out = await pipeline.playable(["Boards Of Canada"], 5)
    // Old code rebuilt the map from a.name ("Boards of Canada") and looked up
    // "Boards Of Canada" → miss → confirmed, persisted, never shown.
    expect(out.get("Boards Of Canada")?.id).toBe(BOC)
    expect(out.has("Boards of Canada")).toBe(false)
  })

  it("mints fresh names, confirms via iTunes, and persists positives BEFORE returning", async () => {
    const { pipeline, fake, calls } = setup()
    const out = await pipeline.playable(["New Artist"], 5)
    const a = out.get("New Artist")!
    expect(a.topTracks).toHaveLength(1)
    expect(calls.itunes).toEqual(["New Artist"])
    expect(fake.tables.artists.map((r) => r.name)).toEqual(["New Artist"])
    // Read-after-write (#162): the row is there the moment playable() resolves.
    expect(fake.tables.artist_tracks_cache).toEqual([
      expect.objectContaining({ artist_id: a.id, source: "itunes" }),
    ])
  })

  it("rehydrate: cached positive skips iTunes; fresh negative is dropped without iTunes", async () => {
    const { pipeline, calls } = setup({
      artists: [artistsRow(POS, "Warm"), artistsRow(NEG, "Dead")],
      artist_tracks_cache: [
        { artist_id: POS, tracks: [track("cached")], source: "itunes", fetched_at: fresh() },
        { artist_id: NEG, tracks: [], source: "none", fetched_at: fresh() },
      ],
    })
    const out = await pipeline.playable(["Warm", "Dead"], 5)
    expect(calls.itunes).toEqual([])
    expect(out.get("Warm")?.topTracks?.[0].id).toBe("it-cached")
    expect(out.has("Dead")).toBe(false)
  })

  it("persists a definitive negative; an iTunes failure writes nothing", async () => {
    const { pipeline, fake } = setup({}, { Empty: [], Broken: null })
    const out = await pipeline.playable(["Empty", "Broken"], 5)
    expect(out.size).toBe(0)
    const rows = fake.tables.artist_tracks_cache
    const idOf = (n: string) => fake.tables.artists.find((r) => r.name === n)!.id
    expect(rows).toEqual([expect.objectContaining({ artist_id: idOf("Empty"), source: "none", tracks: [] })])
  })

  it("the keep gate runs before confirm: an excluded artist costs no iTunes call", async () => {
    const { pipeline, calls } = setup({ artists: [artistsRow(POS, "Hidden")] })
    const out = await pipeline.playable(["Hidden", "Shown"], 5, (a: Artist) => a.id !== POS)
    expect([...out.keys()]).toEqual(["Shown"])
    expect(calls.itunes).toEqual(["Shown"])
  })

  it("stops confirming at the target", async () => {
    const { pipeline, calls } = setup()
    const out = await pipeline.playable(["A", "B", "C", "D"], 2)
    expect(out.size).toBe(2)
    expect(calls.itunes).toHaveLength(2)
  })
})

describe("PlayableCandidates resolve / confirm / flush (Feed tiers)", () => {
  it("resolve reports raw stats pre-gate and rehydrated kept artists keyed by input name", async () => {
    const { pipeline } = setup({
      artists: [artistsRow(POS, "warm one")],
      artist_tracks_cache: [{ artist_id: POS, tracks: [track("w")], source: "itunes", fetched_at: fresh() }],
    })
    const { artists, stats } = await pipeline.resolve(["Warm One", "Gated"], { keep: (a) => a.name !== "Gated" })
    expect(stats.resolved.size).toBe(2)
    expect([...artists.keys()]).toEqual(["Warm One"])
    expect(artists.get("Warm One")?.topTracks).toHaveLength(1)
  })

  it("confirm collects outcomes but nothing is written until flush()", async () => {
    const { pipeline, fake } = setup()
    const { artists } = await pipeline.resolve(["X", "Y"])
    const { kept } = await pipeline.confirm([...artists.values()].map((artist) => ({ artist })), 5)
    expect(kept).toHaveLength(2)
    expect(fake.tables.artist_tracks_cache).toHaveLength(0)
    await pipeline.flush()
    expect(fake.tables.artist_tracks_cache).toHaveLength(2)
  })

  it("one doorway per pipeline: the same name across two resolves mints one row", async () => {
    const { pipeline, fake } = setup()
    const a = await pipeline.resolve(["Same"])
    const b = await pipeline.resolve(["Same"])
    expect(a.artists.get("Same")?.id).toBe(b.artists.get("Same")?.id)
    expect(fake.tables.artists).toHaveLength(1)
  })
})
