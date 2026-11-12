/**
 * Cost bench for buildRecommendations (opt-in: `BENCH=1 npx vitest run lib/recommendation/engine.bench`).
 * Real Last.fm adapter (cache layer + limiter) over a fake fetch (80 ms) and a fake
 * lastfm_cache store (30 ms); in-memory Supabase with 30 ms per query; iTunes 120 ms
 * behind a 5-wide / 50 ms limiter. Counts live calls + DB round trips to tier-1
 * return and after the background settles.
 */
import { describe, it, vi } from "vitest"
import { createFakeSupabase, type Tables } from "./__fixtures__/fake-supabase"
import { createLastfmLimiter } from "@/lib/lastfm/limit"
import { createLimiter } from "@/lib/limiter"
import type { Track } from "@/lib/music-provider/types"

const LFM_MS = 80
const DB_MS = 30
const ITUNES_MS = 120

const h = vi.hoisted(() => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  fake: { client: null as any, tables: {} as Record<string, any[]>, queries: [] as unknown[] },
  lfm: {} as Record<string, number>,
  cacheReads: 0,
  cacheWrites: 0,
  itunes: 0,
  store: new Map<string, { payload: unknown; fetched_at: string }>(),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  limiter: null as any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  itunesLimiter: null as any,
}))

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
function hash(s: string): number {
  let x = 2166136261
  for (let i = 0; i < s.length; i++) x = Math.imul(x ^ s.charCodeAt(i), 16777619)
  return x >>> 0
}

vi.mock("@/lib/supabase/server", () => ({ createServiceClient: () => h.fake.client, createClient: () => h.fake.client }))

vi.mock("@/lib/lastfm", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/lastfm")>()
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
  const hs = (s: string) => {
    let x = 2166136261
    for (let i = 0; i < s.length; i++) x = Math.imul(x ^ s.charCodeAt(i), 16777619)
    return x >>> 0
  }
  const GENRES = ["shoegaze", "dream pop", "post-punk", "trip-hop", "indie rock", "ambient", "noise pop", "slowcore"]
  const body = (u: URL): unknown => {
    const m = u.searchParams.get("method")
    if (m === "artist.getSimilar") {
      const a = u.searchParams.get("artist")!
      return { similarartists: { artist: Array.from({ length: 50 }, (_, i) => ({ name: `Artist ${hs(a + i) % 600}`, match: 1 - i / 50 })) } }
    }
    if (m === "tag.gettopartists") {
      const t = u.searchParams.get("tag")!
      const n = Number(u.searchParams.get("limit") ?? 20)
      return { topartists: { artist: Array.from({ length: n }, (_, i) => ({ name: i % 2 ? `Artist ${hs(t + i) % 600}` : `Tagged ${t} ${i}` })) } }
    }
    if (m === "artist.getInfo") {
      const a = u.searchParams.get("artist")!
      const k = hs(a)
      return { artist: { stats: { listeners: String(10 ** (3 + (k % 4)) + (k % 997)) }, tags: { tag: [{ name: GENRES[k % 8] }, { name: GENRES[(k >> 3) % 8] }] } } }
    }
    return {}
  }
  const lastfm = mod.createLastfm({
    apiKey: () => "k",
    limiter: { run: (fn) => h.limiter.run(fn) },
    fetch: async (input) => {
      const u = new URL(String(input))
      const m = u.searchParams.get("method")!
      h.lfm[m] = (h.lfm[m] ?? 0) + 1
      await wait(80)
      return new Response(JSON.stringify(body(u)))
    },
    cache: {
      read: async (kind, key) => { h.cacheReads++; await wait(30); return h.store.get(`${kind}|${key}`) ?? null },
      readMany: async (kind, keys) => {
        h.cacheReads++
        await wait(30)
        const out = new Map<string, { payload: unknown; fetched_at: string }>()
        for (const k of keys) { const r = h.store.get(`${kind}|${k}`); if (r) out.set(k, r) }
        return out
      },
      write: async (kind, key, payload) => { h.cacheWrites++; await wait(30); h.store.set(`${kind}|${key}`, { payload, fetched_at: new Date().toISOString() }) },
    },
  })
  return { ...mod, lastfm }
})

vi.mock("@/lib/music-provider/itunes", () => ({
  searchTracksByArtist: (name: string): Promise<Track[] | null> =>
    h.itunesLimiter.run(async () => {
      h.itunes++
      await new Promise((r) => setTimeout(r, 120))
      let x = 2166136261
      for (let i = 0; i < name.length; i++) x = Math.imul(x ^ name.charCodeAt(i), 16777619)
      if ((x >>> 0) % 7 === 0) return []
      return [{ id: `it-${name}`, spotifyTrackId: null, name: `${name} song`, previewUrl: `https://a/${encodeURIComponent(name)}.m4a`, durationMs: 30000, albumName: "A", albumImageUrl: null, source: "itunes" }]
    }),
}))

import { buildRecommendations } from "./engine"

function seedDb(tables: Tables) {
  const f = createFakeSupabase({
    users: [{ id: "u1", selected_genres: ["shoegaze", "post-punk", "trip-hop"] }],
    seed_artists: ["Seed A", "Seed B", "Seed C", "Seed D", "Seed E"].map((name) => ({ user_id: "u1", name })),
    feedback: [], listened_artists: [], artists: [], recommendation_cache: [], artist_tracks_cache: [], saves: [],
    ...tables,
  })
  const from = f.client.from
  f.client.from = (t: string) => {
    const q = from(t)
    const then = q.then
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    q.then = (res: any, rej: any) => sleep(DB_MS).then(() => then.call(q, res, rej))
    return q
  }
  h.fake = f
}

function snap() {
  const lfmLive = Object.values(h.lfm).reduce((a, b) => a + b, 0)
  return { lfmLive, byMethod: { ...h.lfm }, lfmCacheReads: h.cacheReads, lfmCacheWrites: h.cacheWrites, dbQueries: h.fake.queries.length, itunes: h.itunes }
}

async function settle() {
  let last = ""
  for (let stable = 0; stable < 4; ) {
    await sleep(250)
    const s = JSON.stringify(snap())
    stable = s === last ? stable + 1 : 0
    last = s
  }
}

async function scenario(label: string, input: { adventurous?: boolean }, fresh: boolean, tables: Tables = {}) {
  if (fresh) { h.store.clear(); seedDb(tables) }
  h.fake.queries.length = 0
  h.lfm = {}; h.cacheReads = 0; h.cacheWrites = 0; h.itunes = 0
  h.limiter = createLastfmLimiter(process.env.BENCH_CAP ? { capacity: Number(process.env.BENCH_CAP) } : {})
  h.itunesLimiter = createLimiter({ maxConcurrency: 5, minIntervalMs: 50 })
  let seed = 42
  vi.spyOn(Math, "random").mockImplementation(() => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31))
  const t0 = Date.now()
  const r = await buildRecommendations({ userId: "u1", accessToken: "", playThreshold: 5, popularityCurve: 0.95, deepDiscovery: input.adventurous, adventurous: input.adventurous })
  const tier1Ms = Date.now() - t0
  const atReturn = snap()
  await r.finish()
  await settle()
  const total = snap()
  const rows = h.fake.tables.recommendation_cache.length
  vi.restoreAllMocks()
  console.log(JSON.stringify({ label, metrics: r.metrics, count: r.count, softened: r.softenedFilters, tier1Ms, atReturn, total, rows, adjacentFiller: h.fake.tables.recommendation_cache.filter((x) => x.source === "adjacent_bleed" || x.source === "far_pool").length }))
}

describe.skipIf(!process.env.BENCH)("engine cost bench", () => {
  it("measures", async () => {
    void LFM_MS; void ITUNES_MS; void hash
    await scenario("normal-cold", {}, true)
    h.fake.tables.recommendation_cache.length = 0 // another user, same taste: shared caches warm
    await scenario("normal-warm", {}, false)
    await scenario("wander-cold", { adventurous: true }, true)
    const listened = Array.from({ length: 600 }, (_, n) => ({ id: `l${String(n).padStart(4, "0")}`, user_id: "u1", artist_id: null, lastfm_artist_name: `Artist ${n}`, play_count: 8 }))
    await scenario("soften-cold", {}, true, { listened_artists: listened })
    // Thin signal: 70% of the similar pool already heard, so the pick is short and backfills.
    await scenario("short-cold", {}, true, { listened_artists: listened.filter((_, n) => n % 10 < 7) })
  }, 120_000)
})
