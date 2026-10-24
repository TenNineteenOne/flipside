import { musicProvider } from '@/lib/music-provider/provider'
import type { Artist } from '@/lib/music-provider/types'
import type { SimilarArtistRef } from '@/lib/music-provider'
import { createServiceClient } from '@/lib/supabase/server'
import {
  UNDERGROUND_MAX_POPULARITY,
  type BuildResult,
  type RecommendationInput,
  type ScoredArtist,
  type SoftenedFilters,
} from './types'
import { isEligibleForCooldown, loadExclusions } from './exclusions'
import { PlayableCandidates, type PlayablePorts } from './playable-candidates'
import { searchTracksByArtist } from '@/lib/music-provider/itunes'
import { fetchArtistEnrichment, buildEnrichArtist } from './enrich-artist'
import { normalizedIncludes, normalizeGenre } from '@/lib/genre/normalize'
import { adjacentGenres } from '@/lib/genre/adjacency'
import { cachedTagArtistNames } from '@/lib/lastfm-cache'
import { runLastfm } from '@/lib/lastfm-limit'
import { incLastfmTag } from '@/lib/recommendation/api-call-counter'
import coldStartData from '@/data/cold-start-seeds.json'
import { sampleLikes, LIKE_SAMPLE_SIZE } from './window'
import { applyClusterCap } from './cluster-cap'
import { splitResolvePools } from './resolve-pools'

const LASTFM_BASE = "https://ws.audioscrobbler.com/2.0"

/** Adventurous soft penalty applied to candidates whose Spotify popularity > 50. */
const ADVENTUROUS_MAINSTREAM_PENALTY = 0.08
/** Source bonus for adjacent-bleed picks over same-formula main-pool scoring. */
const ADJACENT_BLEED_BONUS = 0.08
/** User needs this many selected_genres before seed cap widens 10 → 15 and medium adjacency opens up. */
const ADAPTIVE_BROADEN_THRESHOLD = 10

/**
 * Resolver tuning (safe-C). Conservative bump over the resolver defaults
 * (concurrency 4 / delay 200ms). The resolver has 429 backoff with a budget,
 * so over-tuning degrades to slower, never empty. Validate the measured 429
 * rate via the [gen-timing] rl/retries fields before going higher.
 */
const RESOLVE_CONCURRENCY = 6
const RESOLVE_DELAY_MS = 125

/**
 * Return the popularity-tier multiplier for a Spotify popularity value (0–100).
 * `curveK` is the base of the exponential (users.popularity_curve). Smaller =
 * steeper = stronger obscurity preference. Defaults to 0.95 for callers that
 * haven't been plumbed through yet.
 */
export function tierMultiplier(popularity: number, curveK = 0.95): number {
  return Math.pow(curveK, popularity)
}

// Lower than the 8s used elsewhere: fetchTagArtistNames may fire TWO sequential
// calls (as-is, then a spaced retry on empty), so a high per-call ceiling stacks
// into a ~16s worst case. Valid tag.gettopartists responses return in <1s; 5s is
// ample headroom while bounding the retry path's cold-start cost.
const LASTFM_TIMEOUT_MS = 5000

/**
 * Single live `tag.gettopartists` call. Returns the names ([] when the tag
 * genuinely has no top artists), and THROWS on a transient failure (non-2xx,
 * timeout, network error) so the cache layer can tell "genuinely empty"
 * (negative-cacheable) from "fetch failed" (must not be cached). Gated by the
 * shared Last.fm concurrency cap.
 */
async function fetchTagArtistNamesRaw(tag: string, limit: number, apiKey: string): Promise<string[]> {
  return runLastfm(async () => {
    const url =
      `${LASTFM_BASE}/?method=tag.gettopartists` +
      `&tag=${encodeURIComponent(tag)}&api_key=${apiKey}&format=json&limit=${limit}`
    incLastfmTag()
    const res = await fetch(url, { signal: AbortSignal.timeout(LASTFM_TIMEOUT_MS) })
    if (!res.ok) throw new Error(`lastfm tag.gettopartists ${res.status}`)
    const data = await res.json()
    const artists = data?.topartists?.artist
    if (!Array.isArray(artists)) return []
    return (artists as Array<{ name: string }>).map((a) => a.name).filter(Boolean)
  })
}

/**
 * Fetch top-artist names for a Last.fm tag, tolerating the two tag spellings
 * we deal in. Genre-tree leaf tags are hyphenated slugs (e.g.
 * "dutch-black-metal") but Last.fm indexes most multi-word tags space-
 * separated ("dutch black metal" → 267 artists vs 0 for the hyphenated form).
 * We try the tag as-is FIRST so canonical hyphenated tags (trip-hop, post-punk)
 * keep their better-curated results, and only retry empties with spaces.
 *
 * Throws on transient failure of the primary spelling (so it isn't cached); a
 * genuinely-empty primary result is returned as [] when the spaced retry also
 * comes back empty or fails.
 */
export async function fetchTagArtistNames(tag: string, limit: number): Promise<string[]> {
  const apiKey = process.env.LASTFM_API_KEY
  if (!apiKey) return []
  const names = await fetchTagArtistNamesRaw(tag, limit, apiKey)
  if (names.length > 0 || !tag.includes('-')) return names
  try {
    return await fetchTagArtistNamesRaw(tag.replace(/-/g, ' '), limit, apiKey)
  } catch {
    return names // primary spelling was genuinely empty; don't let a retry blip mask that
  }
}

/**
 * Fetch artist names for a Last.fm genre tag. `limit` controls how many top
 * artists to request; default 20 matches the engine's main-pool seeding. The
 * Explore "Left-field" rail passes `limit=30` so it can sample from positions
 * 10-30 (deeper cuts). Return order matches Last.fm's rank order.
 *
 * Results pass through a shared 7-day Supabase cache (lastfm_cache) so cold
 * Explore loads don't redo the same tag.gettopartists call every time.
 */
export async function getTagArtistNames(tag: string, limit = 20): Promise<string[]> {
  return cachedTagArtistNames(tag, limit, fetchTagArtistNames)
}

/**
 * Spotify-free name resolver (Stage 2, #157). The `searchArtists` dep for
 * resolve-candidates, wired to Last.fm artist.getInfo instead of Spotify
 * /search so generation no longer dies when the shared Spotify key is
 * 429-throttled.
 *
 * getInfo is the SAME cached call `buildEnrichArtist` uses (7-day, negative-
 * cached via cachedArtistEnrichment), so this adds ~0 extra network: on a hit
 * it's free; on a miss the enrich dep would have fired it anyway. Returns a
 * single Artist carrying the genres/popularity from getInfo, or [] for a
 * genuine "artist not found" (null enrichment).
 *
 *  - `id: ""` — the canonical uuid is minted downstream (resolve-candidates
 *    calls mintArtist → ArtistIdentity.ensure by name, then re-keys `.id`).
 *  - `spotifyId: null` — Last.fm has no Spotify id; the #159 worker backfills it.
 *  - `imageUrl: null` — getInfo's image is a placeholder; Stage 3 fills real art.
 *
 * Never rate-limits (the shared Last.fm limiter handles pacing), so it returns
 * Artist[] and never a RateLimited sentinel.
 */
export function lastfmResolve(name: string): Promise<Artist[]> {
  const apiKey = process.env.LASTFM_API_KEY
  if (!apiKey) return Promise.resolve([])
  return fetchArtistEnrichment(name, apiKey).then((e) =>
    e
      ? [{ id: "", spotifyId: null, name, genres: e.genres, popularity: e.popularity, imageUrl: null }]
      : [],
  )
}

/**
 * The live outbound ports for the PlayableCandidates pipeline, shared by Feed
 * and Explore: Last.fm getInfo as the doorway lookup + enrichment, iTunes-first
 * previews (free, no auth, near-universal 30s clips), Spotify top-tracks as the
 * fallback — keyed on the SPOTIFY id, never the uuid identity; no id (Last.fm-
 * only artist) or no token → no-op to [].
 */
export function livePlayablePorts(accessToken: string): PlayablePorts {
  return {
    searchArtists: (name) => lastfmResolve(name),
    enrichArtist: buildEnrichArtist(),
    searchItunes: (name) => searchTracksByArtist(name, 'US', 5),
    getSpotifyTopTracks: (spotifyId) =>
      accessToken && spotifyId
        ? musicProvider.getArtistTopTracks(accessToken, spotifyId, 5, 'US').catch(() => [])
        : Promise.resolve([]),
  }
}

// ── Seed gathering ──────────────────────────────────────────────────────────

type SupabaseClient = ReturnType<typeof createServiceClient>

async function gatherSeedContext(
  userId: string,
  supabase: SupabaseClient
): Promise<{ seedNames: string[]; userGenres: string[] }> {
  const [dbSeeds, thumbsUpRows, userRow] = await Promise.all([
    supabase
      .from('seed_artists')
      .select('name')
      .eq('user_id', userId)
      .then(({ data }) => (data ?? []).map((r) => r.name as string).filter(Boolean)),

    // Fetch the full thumbs-up set; sampling is applied below via
    // sampleLikes() so the Feed draws the same 10 random likes Explore uses
    // within a cache window. See docs/prd-diversity-overhaul.md (M1).
    supabase
      .from('feedback')
      .select('artist_id')
      .eq('user_id', userId)
      .eq('signal', 'thumbs_up')
      .is('deleted_at', null)
      .then(({ data }) => (data ?? []).map((r) => r.artist_id as string).filter(Boolean)),

    supabase
      .from('users')
      .select('selected_genres')
      .eq('id', userId)
      .maybeSingle()
      .then(({ data }) => data),
  ])

  const names: string[] = [...dbSeeds]

  const sampledThumbsUp = sampleLikes(thumbsUpRows, userId)
  const userGenres = ((userRow?.selected_genres as string[] | null) ?? [])
  const topGenres = userGenres.slice(0, 5)

  const [thumbsUpNames, genreBatches] = await Promise.all([
    // Resolve sampled thumbs-up IDs → names via the rec cache.
    sampledThumbsUp.length === 0
      ? Promise.resolve([] as string[])
      : supabase
          .from('recommendation_cache')
          .select('artist_data')
          .eq('user_id', userId)
          .in('artist_id', sampledThumbsUp)
          .then(({ data }) =>
            (data ?? [])
              .map((row) => (row.artist_data as { name?: string })?.name)
              .filter((n): n is string => !!n)
          ),
    // Genre seed names from Last.fm tags (each cached).
    topGenres.length === 0
      ? Promise.resolve([] as string[])
      : Promise.all(topGenres.map(getTagArtistNames)).then((batches) => batches.flat()),
  ])

  names.push(...thumbsUpNames)
  names.push(...genreBatches)

  console.log(
    `[engine] gather userId=${userId} selected_genres=${JSON.stringify(topGenres)} ` +
    `dbSeeds=${dbSeeds.length} thumbsUpTotal=${thumbsUpRows.length} ` +
    `thumbsUpSample=${sampledThumbsUp.length}/${LIKE_SAMPLE_SIZE} ` +
    `totalPooled=${names.length}`
  )

  const deduped = [...new Set(names)]
  for (let i = deduped.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[deduped[i], deduped[j]] = [deduped[j], deduped[i]]
  }
  return { seedNames: deduped, userGenres }
}

// ── Core pipeline ───────────────────────────────────────────────────────────

/**
 * Round-robin interleave across seed similar-lists so each seed contributes
 * equally to the primary candidate pool. Without this, map insertion order
 * equals seed order and a single mainstream-biased seed can flood the first
 * BLOCKING_RESOLVE_CAP slots with its whole similars list.
 *
 * With `tailFirst`, each seed's list is consumed from the END (lowest-match
 * items first). Last.fm orders similars by similarity, which correlates with
 * popularity/mainstream-ness, so tail items are less-obvious picks.
 */
export function buildRoundRobinNames(
  lfmResults: { seed: string; names: string[] }[],
  knownNames: Set<string>,
  opts: { tailFirst?: boolean } = {}
): string[] {
  const tailFirst = opts.tailFirst ?? false
  const out: string[] = []
  const seen = new Set<string>()
  const maxLen = Math.max(0, ...lfmResults.map((r) => r.names.length))
  for (let i = 0; i < maxLen; i++) {
    for (const { names } of lfmResults) {
      const idx = tailFirst ? names.length - 1 - i : i
      if (idx < 0 || idx >= names.length) continue
      const n = names[idx]
      if (!n) continue
      const key = n.toLowerCase()
      if (seen.has(key) || knownNames.has(key)) continue
      seen.add(key)
      out.push(n)
    }
  }
  return out
}

/**
 * Deep-discovery 2nd-hop walk. For each seed, takes its N lowest-match first-hop
 * similars (furthest from seed's typical neighborhood, likeliest to be niche) and
 * calls getSimilar on each. Merges 2nd-hop refs back under the parent seed so
 * round-robin and per-source-seed penalty semantics are preserved.
 */
export async function runDeepHop(
  firstHop: { seed: string; items: SimilarArtistRef[] }[],
  fetchSimilar: (name: string) => Promise<SimilarArtistRef[]>,
  hopsPerSeed = 3
): Promise<{ seed: string; items: SimilarArtistRef[] }[]> {
  const bySeed = new Map<string, SimilarArtistRef[]>()
  for (const { seed, items } of firstHop) bySeed.set(seed, [...items])

  const tasks = firstHop.flatMap(({ seed, items }) =>
    [...items]
      .sort((a, b) => a.match - b.match)
      .slice(0, hopsPerSeed)
      .map(async (niche) => ({
        parentSeed: seed,
        hopItems: await fetchSimilar(niche.name),
      }))
  )
  // allSettled so one failed Last.fm lookup doesn't nuke the whole hop batch.
  const settled = await Promise.allSettled(tasks)
  const hops = settled
    .filter((r): r is PromiseFulfilledResult<{ parentSeed: string; hopItems: SimilarArtistRef[] }> => r.status === "fulfilled")
    .map((r) => r.value)

  for (const { parentSeed, hopItems } of hops) {
    const existing = bySeed.get(parentSeed)
    if (!existing) continue
    const seen = new Set(existing.map((i) => i.name.toLowerCase()))
    for (const hi of hopItems) {
      const key = hi.name.toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      existing.push(hi)
    }
  }

  return [...bySeed.entries()].map(([seed, items]) => ({ seed, items }))
}

/**
 * Greedy pick with soft per-genre AND per-source-seed diversity penalties.
 * Soft penalties bias the ranking; the hard 25% cluster cap runs downstream
 * (see applyClusterCap call in buildRecommendations) as a final guarantee.
 */
export function greedyPickTop(
  pool: ScoredArtist[],
  maxSize = 20,
  genreWeight = 0.10,
  sourceWeight = 0.08
): ScoredArtist[] {
  const working = [...pool]
  const top: ScoredArtist[] = []
  const genreCounts = new Map<string, number>()
  const sourceSeedCounts = new Map<string, number>()
  while (top.length < maxSize && working.length > 0) {
    let bestIdx = 0
    let bestAdjusted = -Infinity
    for (let i = 0; i < working.length; i++) {
      const primary = working[i].artist.genres[0] ?? 'unknown'
      const gCount = genreCounts.get(primary) ?? 0
      const srcPenalty = working[i].why.sourceArtists.reduce(
        (acc, s) => acc + (sourceSeedCounts.get(s) ?? 0) * sourceWeight,
        0
      )
      const adjusted = working[i].score - gCount * genreWeight - srcPenalty
      if (adjusted > bestAdjusted) {
        bestAdjusted = adjusted
        bestIdx = i
      }
    }
    const picked = working.splice(bestIdx, 1)[0]
    const primary = picked.artist.genres[0] ?? 'unknown'
    genreCounts.set(primary, (genreCounts.get(primary) ?? 0) + 1)
    for (const s of picked.why.sourceArtists) {
      sourceSeedCounts.set(s, (sourceSeedCounts.get(s) ?? 0) + 1)
    }
    top.push(picked)
  }
  return top
}

/**
 * Top up a short picked list to `target` from a reserve pool, best-score first,
 * skipping artists already picked. Pure: the engine builds `reserve` from the
 * (already preview-confirmed) secondary pool and calls this only when preview
 * drops thinned the primary pick below target. Returns `picked` unchanged when
 * already at/over target or when the reserve can't fill the gap (short feed
 * degrades gracefully rather than erroring).
 */
export function backfillToTarget(
  picked: ScoredArtist[],
  reserve: ScoredArtist[],
  target: number
): ScoredArtist[] {
  if (picked.length >= target) return picked
  const have = new Set(picked.map((p) => p.artist.id))
  const candidates = reserve
    .filter((r) => !have.has(r.artist.id))
    .sort((a, b) => b.score - a.score)
  const out = [...picked]
  for (const r of candidates) {
    if (out.length >= target) break
    if (have.has(r.artist.id)) continue
    have.add(r.artist.id)
    out.push(r)
  }
  return out
}

/**
 * Post-pipeline merge that injects a small number of adjacent-genre picks at
 * positions where they can't displace the top relevance picks. Treats
 * `userGenres` as the root set and samples close (and optionally medium)
 * adjacent tags, excluding tags the user already selected.
 *
 * Position constraint lives ONLY here — `greedyPickTop` is pure relevance,
 * bleed is pure discovery, and the merge is where the policy lands.
 */
export interface AugmentAdjacentOpts {
  userGenres: string[]
  adventurous?: boolean
  adaptiveBroadening?: boolean
  popularityCurve: number
  undergroundMode?: boolean
  fetchTagArtists: (tag: string) => Promise<string[]>
  /** Resolve names → artists, keyed by input name, with the user's exclusions already applied. */
  resolveArtists: (names: string[]) => Promise<Map<string, Artist>>
}

export async function augmentWithAdjacent(
  base: ScoredArtist[],
  opts: AugmentAdjacentOpts
): Promise<ScoredArtist[]> {
  if (base.length === 0 || opts.userGenres.length === 0) return base
  const adventurous = !!opts.adventurous
  const adaptive = !!opts.adaptiveBroadening

  // Exploration budget (M3): 4 / 10 injections for 20% / 50% of a 20-item feed.
  const N = adventurous ? 10 : 4
  const startPos = adventurous ? 3 : 5
  if (base.length <= startPos) return base

  const userGenreKeys = new Set(opts.userGenres.map((g) => normalizeGenre(g)))
  const tagSet = new Set<string>()
  for (const g of opts.userGenres.slice(0, 5)) {
    for (const adj of adjacentGenres(g, 'close')) {
      if (!userGenreKeys.has(normalizeGenre(adj))) tagSet.add(adj)
    }
    if (adaptive) {
      for (const adj of adjacentGenres(g, 'medium')) {
        if (!userGenreKeys.has(normalizeGenre(adj))) tagSet.add(adj)
      }
    }
  }

  const tags = [...tagSet]
  for (let i = tags.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[tags[i], tags[j]] = [tags[j], tags[i]]
  }
  // Each tag yields ~20 Last.fm names, from which most filter out. maxTags
  // needs to scale with N so 10-pick Adventurous has enough surviving
  // candidates after dedup + thumbs-down + listened filters.
  const maxTags = adventurous ? 10 : 5
  const sampled = tags.slice(0, maxTags)
  if (sampled.length === 0) return base

  const tagToNames = new Map<string, string[]>()
  const fetchResults = await Promise.all(
    sampled.map(async (tag) => ({ tag, names: await opts.fetchTagArtists(tag) }))
  )
  const allNames = new Set<string>()
  for (const { tag, names } of fetchResults) {
    tagToNames.set(tag, names)
    for (const n of names) allNames.add(n)
  }

  const baseNameLc = new Set(base.map((b) => b.artist.name.toLowerCase()))
  const toResolve = [...allNames].filter((n) => !baseNameLc.has(n.toLowerCase()))
  if (toResolve.length === 0) return base

  const resolved = await opts.resolveArtists(toResolve)
  const baseIds = new Set(base.map((b) => b.artist.id))
  const nameToTag = new Map<string, string>()
  for (const [tag, names] of tagToNames) {
    for (const n of names) {
      const key = n.toLowerCase()
      if (!nameToTag.has(key)) nameToTag.set(key, tag)
    }
  }

  const scored: ScoredArtist[] = []
  for (const [name, artist] of resolved.entries()) {
    if (baseIds.has(artist.id)) continue
    if (opts.undergroundMode && (artist.popularity ?? 0) > UNDERGROUND_MAX_POPULARITY) continue

    const tag = nameToTag.get(name.toLowerCase()) ?? ''
    const seedRelevance = 0.3
    const tier = tierMultiplier(artist.popularity, opts.popularityCurve)
    const discoveryPenalty = opts.undergroundMode
      ? Math.pow((100 - artist.popularity) / 100, 2)
      : 1
    const baseScore = tier * 0.8 + seedRelevance * 0.2
    const mainstreamPenalty =
      adventurous && artist.popularity > 50 ? ADVENTUROUS_MAINSTREAM_PENALTY : 0
    const score = baseScore * discoveryPenalty + ADJACENT_BLEED_BONUS - mainstreamPenalty

    scored.push({
      artist: { ...artist, topTracks: artist.topTracks ?? [] },
      score,
      why: {
        sourceArtists: tag ? [tag] : [],
        genres: artist.genres.slice(0, 2),
        friendBoost: [],
      },
      source: 'adjacent_bleed',
    })
  }

  if (scored.length === 0) return base
  scored.sort((a, b) => b.score - a.score)
  const picks = scored.slice(0, N)

  const mergeable = base.slice(startPos).map((item, idx) => ({
    score: item.score,
    idx: idx + startPos,
  }))
  mergeable.sort((a, b) => a.score - b.score)
  const toReplace = new Set(mergeable.slice(0, picks.length).map((m) => m.idx))

  const out: ScoredArtist[] = []
  let pickIdx = 0
  for (let i = 0; i < base.length; i++) {
    if (toReplace.has(i) && pickIdx < picks.length) {
      out.push(picks[pickIdx++])
    } else {
      out.push(base[i])
    }
  }
  return out
}

export interface RunPipelineOpts {
  seedNames: string[]
  accessToken: string
  userId: string
  playThreshold: number
  popularityCurve: number
  supabase: SupabaseClient
  source: string
  genre?: string
  undergroundMode?: boolean
  deepDiscovery?: boolean
  adventurous?: boolean
  userGenres?: string[]
}

/**
 * One pipeline run, before composition into the public BuildResult: the
 * tier-1 result plus its two halves of background work, kept apart because
 * softening flushes EVERY run's confirms but finishes only the returned run.
 */
export interface PipelineRun {
  count: number
  metrics: BuildResult['metrics']
  /** Tier-2 + secondary confirm/write; null when the run failed early. */
  runSecondary: (() => Promise<number>) | null
  /** Persist this run's confirm outcomes. Never throws. */
  flush: () => Promise<void>
}

async function runPipeline(o: RunPipelineOpts): Promise<PipelineRun> {
  const {
    seedNames, accessToken, userId, playThreshold, popularityCurve, supabase,
    source, genre, undergroundMode, deepDiscovery, adventurous, userGenres = [],
  } = o

  // ONE pipeline (and so ONE outcome collector, #162) per run. Every resolve
  // (primary, secondary, bleed) shares its doorway; every confirm tier (tier-1
  // blocking, tier-2 deferred, secondary) records outcomes into it, flushed
  // once by finish() (in after()) so a single batch-upsert covers all three phases.
  const candidates = new PlayableCandidates(supabase, livePlayablePorts(accessToken))
  const flush = () => candidates.flush()

  const widenSeedCap = userGenres.length >= ADAPTIVE_BROADEN_THRESHOLD
  const seedCap = widenSeedCap ? 15 : 10
  const capSeedNames = seedNames.slice(0, seedCap)
  console.log(
    `[engine] seeds-post-shuffle source=${source} seedCap=${seedCap} ` +
    `seeds=${JSON.stringify(capSeedNames)} deepDiscovery=${!!deepDiscovery} ` +
    `adventurous=${!!adventurous} userGenres=${userGenres.length}`
  )

  const firstHop = await Promise.all(
    capSeedNames.map(async (name) => ({
      seed: name,
      items: await musicProvider.getSimilarArtistNames(name),
    }))
  )

  const lfmRefResults = deepDiscovery
    ? await runDeepHop(firstHop, (n) => musicProvider.getSimilarArtistNames(n))
    : firstHop

  const lfmResults = lfmRefResults.map(({ seed, items }) => ({
    seed,
    names: items.map((i) => i.name),
  }))

  const knownNames = new Set(capSeedNames.map((n) => n.toLowerCase()))
  const nameToSeeds = new Map<string, string[]>()
  for (const { seed, names } of lfmResults) {
    for (const name of names) {
      if (knownNames.has(name.toLowerCase())) continue
      if (!nameToSeeds.has(name)) nameToSeeds.set(name, [])
      nameToSeeds.get(name)!.push(seed)
    }
  }

  const allNames = buildRoundRobinNames(lfmResults, knownNames, { tailFirst: true })
  const { blocking: uniqueNames, secondary: secondaryNames } = splitResolvePools(allNames)
  const lfmTotal = lfmResults.reduce((sum, r) => sum + r.names.length, 0)

  if (uniqueNames.length === 0) {
    console.error(`[engine] FAIL no_unique seeds=${capSeedNames.length} lfm=${lfmTotal} source=${source}`)
    return { count: 0, runSecondary: null, flush, metrics: { primaryMs: 0, previewMs: 0, firstBatchMs: 0, misses: 0, retries: 0, rateLimited: false } }
  }

  // The one exclusion policy (#175 D3): thumbs-down, listened over the play
  // threshold (by id, or by name for id-less history rows), and the 7-day
  // seen / dismissed cooldown — applied BEFORE confirm so no iTunes call is
  // spent on an artist writeScored would discard.
  const exclusions = await loadExclusions(supabase, userId, { playThreshold, nameFallback: true })
  let filtListened = 0
  /** Every feed candidate gate: exclusions + underground cap + genre filter. */
  const feedKeeps = (artist: Artist, countListened = false): boolean => {
    const why = exclusions.reason(artist)
    if (why) {
      if (countListened && why === 'listened') filtListened++
      return false
    }
    if (undergroundMode && (artist.popularity ?? 0) > UNDERGROUND_MAX_POPULARITY) return false
    if (genre && !artist.genres.some((g) => normalizedIncludes(g, genre))) return false
    return true
  }

  // Fire the secondary resolution in parallel with primary. It's still best-
  // effort and its confirm/write happens later in `runSecondary` (from an
  // `after()` block), but the Last.fm round-trips overlap with the primary
  // resolve instead of waiting for it to finish first. Gated + rehydrated by
  // the same pipeline, so the backfill reserve and the secondary tier both
  // arrive filtered and warm.
  const secondaryResolvePromise = secondaryNames.length === 0
    ? null
    : candidates.resolve(secondaryNames, { keep: (a) => feedKeeps(a) })

  let previewMs = 0
  const primaryStart = Date.now()
  // Resolve → gate → rehydrate: warm artists arrive at preview-confirmation
  // already confirmed (no iTunes call); cold ones fall through to iTunes/Spotify.
  const primary = await candidates.resolve(uniqueNames, {
    keep: (a) => feedKeeps(a, true),
    concurrency: RESOLVE_CONCURRENCY,
    delayMs: RESOLVE_DELAY_MS,
  })
  const resolved = primary.stats
  const primaryMs = Date.now() - primaryStart

  console.log(`[cache-search] hit=${resolved.cacheHits} miss=${resolved.cacheMisses} total=${uniqueNames.length}`)

  // Distinct resolved identities, pre-gate (the `cands` log field).
  const candsCount = new Set([...resolved.resolved.values()].map((a) => a.id)).size
  const candidateMap = new Map<string, { artist: Artist; seedArtists: string[] }>()
  for (const [name, artist] of primary.artists) {
    const seedArtists = nameToSeeds.get(name) ?? []
    if (candidateMap.has(artist.id)) {
      const existing = candidateMap.get(artist.id)!
      for (const s of seedArtists) {
        if (!existing.seedArtists.includes(s)) existing.seedArtists.push(s)
      }
    } else {
      candidateMap.set(artist.id, { artist, seedArtists })
    }
  }
  const filteredCandidates = [...candidateMap.values()]

  // Local scorer — shared by the primary pool and the backfill reserve so the
  // two are ranked on the same scale. (The secondary `runSecondary` closure
  // keeps its own copy; it runs in a separate background pass.)
  const scoreCandidate = (artist: Artist, seedArtists: string[], src: string): ScoredArtist => {
    const seedRelevance = Math.min(Math.sqrt(seedArtists.length) / Math.sqrt(6), 1)
    const tier = tierMultiplier(artist.popularity, popularityCurve)
    const discoveryPenalty = undergroundMode
      ? Math.pow((100 - artist.popularity) / 100, 2)
      : 1
    const baseScore = tier * 0.80 + seedRelevance * 0.20
    const mainstreamPenalty =
      adventurous && artist.popularity > 50 ? ADVENTUROUS_MAINSTREAM_PENALTY : 0
    const score = baseScore * discoveryPenalty - mainstreamPenalty
    return {
      artist: { ...artist, topTracks: artist.topTracks ?? [] },
      score,
      why: {
        sourceArtists: seedArtists.slice(0, 2),
        genres: artist.genres.slice(0, 2),
        friendBoost: [],
      },
      source: src,
    }
  }

  const scored: ScoredArtist[] = filteredCandidates.map(({ artist, seedArtists }) =>
    scoreCandidate(artist, seedArtists, source)
  )

  scored.sort((a, b) => b.score - a.score)

  const pool = scored.slice(0, 40)
  const poolGenreDist = new Map<string, number>()
  for (const s of pool) {
    const g = s.artist.genres[0] ?? "unknown"
    poolGenreDist.set(g, (poolGenreDist.get(g) ?? 0) + 1)
  }
  console.log(
    `[engine] top40-genre-dist source=${source} ` +
    JSON.stringify([...poolGenreDist.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10))
  )

  const baseTop = greedyPickTop(pool, 20)

  // 25% cluster cap (M2) — greedyPickTop's soft penalty nudges diversity, but
  // a high-signal user with one dominant genre can still exceed the budget.
  // Apply a hard cap by swapping over-budget picks with the best remaining
  // pool tail whose primary genre is under-cap.
  const baseTopIds = new Set(baseTop.map((s) => s.artist.id))
  const baseLeftover = pool.filter((s) => !baseTopIds.has(s.artist.id))
  const capStats = applyClusterCap(
    baseTop,
    baseLeftover,
    (s: ScoredArtist) => s.artist.genres[0] ?? 'unknown',
  )
  console.log(
    `[engine] cluster-cap source=${source} swaps=${capStats.swaps} ` +
    `topGenre=${capStats.topGenre} topShare=${capStats.topShare.toFixed(2)}`
  )

  if (baseTop.length === 0) {
    console.error(
      `[engine] FAIL zero_top seeds=${capSeedNames.length} lfm=${lfmTotal} ` +
      `uniq=${uniqueNames.length} ok=${resolved.searchOk} fail=${resolved.searchFail} ` +
      `filtListened=${filtListened} cands=${candsCount} source=${source}`
    )
    return { count: 0, runSecondary: null, flush, metrics: { primaryMs: Date.now() - primaryStart, previewMs, firstBatchMs: 0, misses: resolved.cacheMisses, retries: resolved.searchRetries, rateLimited: resolved.rateLimited } }
  }

  // Post-pipeline adjacent-genre bleed. Skipped when the user has filtered
  // to one genre (?genre=X) — we respect the explicit narrow intent.
  let top = baseTop
  if (!genre && userGenres.length > 0) {
    top = await augmentWithAdjacent(baseTop, {
      userGenres,
      adventurous,
      adaptiveBroadening: widenSeedCap,
      popularityCurve,
      undergroundMode,
      fetchTagArtists: getTagArtistNames,
      // Same pipeline: gated by the exclusions AND rehydrated, so a bleed
      // pick with a cached preview (or a fresh negative) never re-hits iTunes.
      resolveArtists: async (names) =>
        (await candidates.resolve(names, { keep: (a) => !exclusions.reason(a) })).artists,
    })
  }

  // Backfill (#135). Preview-confirmation drops no-preview artists before the
  // pick, so a thin-signal user can land below TARGET. The secondary pool is
  // already resolving in parallel (and is itself preview-confirmed); when we're
  // short, await it and top up from its best filter-passing candidates. Only
  // pays latency in the (rare) short case; full feeds skip the await entirely.
  const TARGET = 20
  const FIRST_BATCH_TARGET = 8
  if (top.length < TARGET && secondaryResolvePromise) {
    const sec = await secondaryResolvePromise
    const pickedIds = new Set(top.map((t) => t.artist.id))
    const reserve: ScoredArtist[] = []
    for (const [name, art] of sec.artists) {
      if (pickedIds.has(art.id)) continue
      reserve.push(scoreCandidate(art, nameToSeeds.get(name) ?? [], `${source}_backfill`))
    }
    const before = top.length
    top = backfillToTarget(top, reserve, TARGET)
    if (top.length > before) {
      console.log(`[engine] backfill source=${source} from=${before} to=${top.length} reserve=${reserve.length}`)
    }
  }

  // Two-phase confirm+write (#144):
  //   Tier 1 (blocking): confirm FIRST_BATCH_TARGET, write, return fast.
  //   Tier 2 (deferred): finish primary to TARGET, then secondary pool — all in after().
  // Every artist written in ANY phase is confirmed-playable (comes through confirmToTarget).

  const inTop = new Set(top.map((t) => t.artist.id))
  const tail = pool.filter((s) => !inTop.has(s.artist.id)) // already score-sorted
  const ordered = [...top, ...tail]

  const now = new Date()
  const expiresAt = new Date(now)
  expiresAt.setDate(expiresAt.getDate() + 30)

  // writtenIds tracks all ids written across tier-1, tier-2, and secondary to
  // avoid duplicate confirms or upserts.
  const writtenIds = new Set<string>()

  /**
   * Write a set of confirmed ScoredArtists to recommendation_cache, skipping
   * cooldown-ineligible rows and ids already written this run. Returns the
   * number of rows successfully upserted.
   *
   * Preserves ALL existing behaviour: cooldown filtering, row shape, expires_at,
   * upsert onConflict. Fetches cooldown state fresh from DB for the given items
   * so concurrent phases never clobber a live seen_at/skip_at.
   */
  async function writeScored(items: ScoredArtist[]): Promise<number> {
    // Exclude ids already written in a previous phase
    const fresh = items.filter((item) => !writtenIds.has(item.artist.id))
    if (fresh.length === 0) return 0

    const ids = fresh.map((item) => item.artist.id)
    const { data: existingCache } = await supabase
      .from('recommendation_cache')
      .select('artist_id, seen_at, skip_at')
      .eq('user_id', userId)
      .in('artist_id', ids)

    const existingSeenAt = new Map<string, string | null>()
    const existingSkipAt = new Map<string, string | null>()
    for (const row of existingCache ?? []) {
      existingSeenAt.set(row.artist_id, row.seen_at)
      existingSkipAt.set(row.artist_id, row.skip_at)
    }

    const rows = fresh
      .filter((item) => {
        const seenAt = existingSeenAt.get(item.artist.id)
        const skipAt = existingSkipAt.get(item.artist.id)
        // Not in cache → eligible. In cache → check both cooldowns.
        if (seenAt === undefined && skipAt === undefined) return true
        return isEligibleForCooldown(seenAt, skipAt, now)
      })
      .map((item) => {
        const previousSeenAt = existingSeenAt.get(item.artist.id)
        const previousSkipAt = existingSkipAt.get(item.artist.id)
        return {
          user_id: userId,
          artist_id: item.artist.id,
          artist_data: item.artist,
          score: item.score,
          why: item.why,
          source: item.source,
          expires_at: expiresAt.toISOString(),
          // Preserve existing cooldown state on re-surface so the window doesn't reset.
          ...(previousSeenAt !== undefined ? { seen_at: previousSeenAt } : { seen_at: null }),
          ...(previousSkipAt !== undefined ? { skip_at: previousSkipAt } : { skip_at: null }),
        }
      })

    if (rows.length === 0) return 0

    const { error } = await supabase
      .from('recommendation_cache')
      .upsert(rows, { onConflict: 'user_id,artist_id' })

    if (error) {
      console.error(`[engine] upsert_error source=${source} err=${error.message}`)
      return 0
    }

    for (const row of rows) writtenIds.add(row.artist_id)
    return rows.length
  }

  // ── Tier 1 (blocking): confirm FIRST_BATCH_TARGET artists, write, return fast ──
  const firstBatchStart = Date.now()
  const { kept: firstBatch, confirmedCount: c1 } = await candidates.confirm(ordered, FIRST_BATCH_TARGET)
  const firstBatchMs = Date.now() - firstBatchStart
  previewMs = firstBatchMs // time the user waited for first paint

  const tier1Written = await writeScored(firstBatch)

  console.log(
    `[engine] tier1 seeds=${capSeedNames.length} lfm=${lfmTotal} uniq=${uniqueNames.length} ` +
    `ok=${resolved.searchOk} fail=${resolved.searchFail} filtListened=${filtListened} ` +
    `cands=${candidateMap.size} firstBatch=${firstBatch.length} written=${tier1Written} source=${source}`
  )

  // ── Background continuation: tier-2 (finish primary to TARGET) + secondary pool ──
  // runSecondary is the run's background half; finish() (called by after() in
  // the route) runs it, then flushes. It:
  //   1. Confirms ordered.slice(c1) up to (TARGET - firstBatch.length) more artists.
  //   2. Writes those via writeScored (deduped against writtenIds).
  //   3. Resolves + confirms + writes the secondary pool (unchanged from before).
  const runSecondary = async (): Promise<number> => {
    let backgroundWritten = 0

    // ── Tier 2: finish primary to TARGET ──
    const tier2Need = TARGET - firstBatch.length
    if (tier2Need > 0 && c1 < ordered.length) {
      const { kept: tier2Batch } = await candidates.confirm(ordered.slice(c1), tier2Need)
      if (tier2Batch.length > 0) {
        const written = await writeScored(tier2Batch)
        backgroundWritten += written
        console.log(
          `[engine] tier2 source=${source} confirmed=${tier2Batch.length} written=${written}`
        )
      }
    }

    // ── Secondary pool ──
    if (secondaryResolvePromise === null) return backgroundWritten

    // Already fetched in parallel with primary — just await the result.
    const secondaryResolved = await secondaryResolvePromise

    const secondaryCandidates: Array<{ artist: Artist; seedArtists: string[] }> = []
    for (const [name, artist] of secondaryResolved.artists) {
      if (writtenIds.has(artist.id)) continue
      const seedArtists = nameToSeeds.get(name) ?? []
      secondaryCandidates.push({ artist, seedArtists })
    }

    if (secondaryCandidates.length === 0) {
      console.log(`[engine] secondary_empty source=${source}`)
      return backgroundWritten
    }

    const secondaryScored: ScoredArtist[] = secondaryCandidates.map(({ artist, seedArtists }) => {
      const seedRelevance = Math.min(Math.sqrt(seedArtists.length) / Math.sqrt(6), 1)
      const tier = tierMultiplier(artist.popularity, popularityCurve)
      const discoveryPenalty = undergroundMode
        ? Math.pow((100 - artist.popularity) / 100, 2)
        : 1
      const baseScore = tier * 0.80 + seedRelevance * 0.20
      const mainstreamPenalty =
        adventurous && artist.popularity > 50 ? ADVENTUROUS_MAINSTREAM_PENALTY : 0
      const score = baseScore * discoveryPenalty - mainstreamPenalty
      return {
        artist: { ...artist, topTracks: artist.topTracks ?? [] },
        score,
        why: {
          sourceArtists: seedArtists.slice(0, 2),
          genres: artist.genres.slice(0, 2),
          friendBoost: [],
        },
        source: `${source}_secondary`,
      }
    })

    secondaryScored.sort((a, b) => b.score - a.score)

    // Confirm only up to TARGET secondary candidates before writing.
    const { kept: secConfirmed } = await candidates.confirm(secondaryScored, TARGET)

    if (secConfirmed.length > 0) {
      const secWritten = await writeScored(secConfirmed)
      backgroundWritten += secWritten
      console.log(
        `[engine] secondary-OK source=${source} names=${secondaryNames.length} ` +
        `resolved=${secondaryResolved.stats.resolved.size} written=${secWritten}`
      )
    } else {
      console.log(`[engine] secondary_all_in_cooldown source=${source}`)
    }

    return backgroundWritten
  }

  return {
    count: tier1Written,
    runSecondary,
    flush,
    metrics: {
      primaryMs,
      previewMs,
      firstBatchMs,
      misses: resolved.cacheMisses,
      retries: resolved.searchRetries,
      rateLimited: resolved.rateLimited,
    },
  }
}

// ── Main entry point ────────────────────────────────────────────────────────

/**
 * Runs the cascade for when the primary pipeline returns count=0.
 *
 * Order:
 *   1. Retry with playThreshold + 5 (in-memory re-filter) — users with
 *      heavy listening history often have everything filtered out.
 *   2. Cold-start fallback — no candidates at all, seed from curated list.
 *
 * The undergroundMode cap is a hard promise: softening never disables it.
 * If no pop≤50 candidates survive, the feed goes short (or falls through
 * to cold-start, which is a separate curated-seed path not subject to
 * the cap — see `soften_cold_start` below).
 *
 * Pure in the sense that all effects flow through the injected `run` and
 * `coldStartSeeds` deps, making the cascade order deterministically testable.
 */
export interface SoftenDeps {
  run: (opts: RunPipelineOpts) => Promise<PipelineRun>
  coldStartSeeds: () => string[]
}

/**
 * Compose the public result. `finish` = the returned run's secondary pass,
 * then EVERY run's flush (each run has its own collector; a softened retry
 * must not discard the earlier runs' confirmed previews — #162, b3e402c).
 */
function composeResult(final: PipelineRun, runs: PipelineRun[], softenedFilters?: SoftenedFilters): BuildResult {
  return {
    count: final.count,
    metrics: final.metrics,
    pending: final.runSecondary != null,
    ...(softenedFilters ? { softenedFilters } : {}),
    finish: async () => {
      try {
        await final.runSecondary?.()
      } finally {
        await Promise.all(runs.map((r) => r.flush()))
      }
    },
  }
}

export async function runWithSoftening(
  baseOpts: RunPipelineOpts,
  deps: SoftenDeps
): Promise<BuildResult> {
  const runs: PipelineRun[] = []
  const run = async (opts: RunPipelineOpts) => {
    const r = await deps.run(opts)
    runs.push(r)
    return r
  }

  const primary = await run(baseOpts)
  if (primary.count > 0) return composeResult(primary, runs)

  const softened: SoftenedFilters = { playThreshold: false, coldStart: false }
  const originalPlayThreshold = baseOpts.playThreshold

  // Soften 1: bump play threshold.
  console.log(`[engine] soften_play_threshold userId=${baseOpts.userId} from=${originalPlayThreshold} to=${originalPlayThreshold + 5}`)
  softened.playThreshold = true
  const r1 = await run({
    ...baseOpts,
    playThreshold: originalPlayThreshold + 5,
    source: 'soften_play_threshold',
  })
  if (r1.count > 0) return composeResult(r1, runs, softened)

  // Soften 2: cold-start fallback. undergroundMode is intentionally off here —
  // cold-start is the degenerate escape hatch for users with no seeds; its
  // curated starter picks are treated as an exception to the cap promise.
  console.log(`[engine] soften_cold_start userId=${baseOpts.userId}`)
  softened.coldStart = true
  const r3 = await run({
    ...baseOpts,
    seedNames: deps.coldStartSeeds(),
    playThreshold: originalPlayThreshold + 5,
    undergroundMode: false,
    source: 'soften_cold_start',
    userGenres: [],
  })
  return composeResult(r3, runs, softened)
}

/**
 * Runs the recommendation pipeline with auto-soften on empty pool.
 *
 * Returns `softenedFilters` so the UI can show a toast explaining the
 * widening. See `runWithSoftening` for the cascade logic.
 */
export async function buildRecommendations(input: RecommendationInput): Promise<BuildResult> {
  const { userId, accessToken, playThreshold, popularityCurve, genre, undergroundMode, deepDiscovery, adventurous } = input
  const supabase = createServiceClient()

  const { seedNames, userGenres } = await gatherSeedContext(userId, supabase)

  const makeBaseOpts = (overrides: Partial<RunPipelineOpts>): RunPipelineOpts => ({
    seedNames,
    accessToken,
    userId,
    playThreshold,
    popularityCurve,
    supabase,
    source: 'multi_source',
    genre,
    undergroundMode,
    deepDiscovery,
    adventurous,
    userGenres,
    ...overrides,
  })

  if (seedNames.length > 0) {
    console.log(
      `[engine] start userId=${userId} seeds=${seedNames.length}${genre ? ` genre=${genre}` : ""} ` +
      `adventurous=${!!adventurous} userGenres=${userGenres.length}`
    )
    return runWithSoftening(makeBaseOpts({}), {
      run: runPipeline,
      coldStartSeeds: sampleColdStartSeeds,
    })
  }

  console.log(`[engine] cold_start userId=${userId}`)
  const coldSeeds = sampleColdStartSeeds()
  const run = await runPipeline(makeBaseOpts({ seedNames: coldSeeds, source: 'cold_start', userGenres: [] }))
  return composeResult(run, [run])
}

function sampleColdStartSeeds(): string[] {
  const pool = [...coldStartData.seeds]
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[pool[i], pool[j]] = [pool[j], pool[i]]
  }
  return pool.slice(0, 5).map((s) => s.name)
}
