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
import { ArtistNameCache } from './artist-name-cache'
import { resolveArtistsByName } from './resolve-candidates'
import { fetchArtistEnrichment } from './enrich-artist'
import { normalizeArtistName } from '@/lib/listened-artists'
import { normalizedIncludes, normalizeGenre } from '@/lib/genre/normalize'
import { adjacentGenres } from '@/lib/genre/adjacency'
import { cachedTagArtistNames } from '@/lib/lastfm-cache'
import coldStartData from '@/data/cold-start-seeds.json'
import { sampleLikes, LIKE_SAMPLE_SIZE } from './window'
import { applyClusterCap } from './cluster-cap'

const LASTFM_BASE = "https://ws.audioscrobbler.com/2.0"

/** Adventurous soft penalty applied to candidates whose Spotify popularity > 50. */
const ADVENTUROUS_MAINSTREAM_PENALTY = 0.08
/** Source bonus for adjacent-bleed picks over same-formula main-pool scoring. */
const ADJACENT_BLEED_BONUS = 0.08
/** User needs this many selected_genres before seed cap widens 10 → 15 and medium adjacency opens up. */
const ADAPTIVE_BROADEN_THRESHOLD = 10

/**
 * Return the popularity-tier multiplier for a Spotify popularity value (0–100).
 * `curveK` is the base of the exponential (users.popularity_curve). Smaller =
 * steeper = stronger obscurity preference. Defaults to 0.95 for callers that
 * haven't been plumbed through yet.
 */
export function tierMultiplier(popularity: number, curveK = 0.95): number {
  return Math.pow(curveK, popularity)
}

async function fetchTagArtistNames(tag: string, limit: number): Promise<string[]> {
  const apiKey = process.env.LASTFM_API_KEY
  if (!apiKey) return []
  try {
    const url =
      `${LASTFM_BASE}/?method=tag.gettopartists` +
      `&tag=${encodeURIComponent(tag)}&api_key=${apiKey}&format=json&limit=${limit}`
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) })
    if (!res.ok) return []
    const data = await res.json()
    const artists = data?.topartists?.artist
    if (!Array.isArray(artists)) return []
    return (artists as Array<{ name: string }>).map((a) => a.name).filter(Boolean)
  } catch {
    return []
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
 * Build a live enrichArtist dep for resolve-candidates. Closes over the
 * Last.fm API key so Spotify `/search` misses (which return empty genres /
 * zero popularity) get filled before the cache write. Returns undefined
 * when the key is missing — callers should feature-detect rather than noop.
 */
function buildEnrichArtist() {
  const apiKey = process.env.LASTFM_API_KEY
  if (!apiKey) return undefined
  return (name: string) => fetchArtistEnrichment(name, apiKey)
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
      .select('spotify_artist_id')
      .eq('user_id', userId)
      .eq('signal', 'thumbs_up')
      .is('deleted_at', null)
      .then(({ data }) => (data ?? []).map((r) => r.spotify_artist_id as string).filter(Boolean)),

    supabase
      .from('users')
      .select('selected_genres')
      .eq('id', userId)
      .maybeSingle()
      .then(({ data }) => data),
  ])

  const names: string[] = [...dbSeeds]

  const sampledThumbsUp = sampleLikes(thumbsUpRows, userId)
  if (sampledThumbsUp.length > 0) {
    const { data: cached } = await supabase
      .from('recommendation_cache')
      .select('artist_data')
      .eq('user_id', userId)
      .in('spotify_artist_id', sampledThumbsUp)
    for (const row of cached ?? []) {
      const name = (row.artist_data as { name?: string })?.name
      if (name) names.push(name)
    }
  }

  const userGenres = ((userRow?.selected_genres as string[] | null) ?? [])
  const topGenres = userGenres.slice(0, 5)
  if (topGenres.length > 0) {
    const genreResults = await Promise.all(topGenres.map(getTagArtistNames))
    for (const batch of genreResults) names.push(...batch)
  }

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

const PRIMARY_RESOLVE_CAP = 60
const SECONDARY_RESOLVE_CAP = 30

/**
 * Round-robin interleave across seed similar-lists so each seed contributes
 * equally to the primary candidate pool. Without this, map insertion order
 * equals seed order and a single mainstream-biased seed can flood the first
 * PRIMARY_RESOLVE_CAP slots with its whole similars list.
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
 * Cooldown gate: a `skip_at` timestamp is a permanent hide ("Dismiss" button).
 * Undo is available from the History page, which clears skip_at via the
 * dismiss RPC. A passive `seen_at` is a 7-day soft cooldown.
 */
export function isEligibleForCooldown(
  seenAt: string | null | undefined,
  skipAt: string | null | undefined,
  now: Date = new Date()
): boolean {
  if (skipAt) return false
  if (seenAt) {
    const days = (now.getTime() - new Date(seenAt).getTime()) / (1000 * 60 * 60 * 24)
    if (days < 7) return false
  }
  return true
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
  thumbsDownIds: Set<string>
  overThresholdIds: Set<string>
  overThresholdNames: Set<string>
  fetchTagArtists: (tag: string) => Promise<string[]>
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
    if (opts.thumbsDownIds.has(artist.id)) continue
    if (opts.overThresholdIds.has(artist.id)) continue
    if (opts.overThresholdNames.has(normalizeArtistName(artist.name))) continue
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
      artist: { ...artist, topTracks: [] },
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

async function runPipeline(o: RunPipelineOpts): Promise<BuildResult> {
  const {
    seedNames, accessToken, userId, playThreshold, popularityCurve, supabase,
    source, genre, undergroundMode, deepDiscovery, adventurous, userGenres = [],
  } = o

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
  const uniqueNames = allNames.slice(0, PRIMARY_RESOLVE_CAP)
  const secondaryNames = allNames.slice(PRIMARY_RESOLVE_CAP, PRIMARY_RESOLVE_CAP + SECONDARY_RESOLVE_CAP)
  const lfmTotal = lfmResults.reduce((sum, r) => sum + r.names.length, 0)

  if (uniqueNames.length === 0) {
    console.error(`[engine] FAIL no_unique seeds=${capSeedNames.length} lfm=${lfmTotal} source=${source}`)
    return { count: 0, runSecondary: null }
  }

  const candidateMap = new Map<string, { artist: Artist; seedArtists: string[] }>()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const nameCache = new ArtistNameCache(supabase as any)

  // Fire the secondary resolution in parallel with primary. It's still best-
  // effort and its scoring/write-back happens later in `runSecondary` (from
  // an `after()` block), but the Spotify/Last.fm round-trips now overlap with
  // the primary resolve instead of waiting for it to finish first. Shared
  // `nameCache` — writes are idempotent, names don't overlap between slices.
  const secondaryResolvePromise = secondaryNames.length === 0
    ? null
    : resolveArtistsByName(secondaryNames, {
        cache: nameCache,
        searchArtists: (name) => musicProvider.searchArtists(accessToken, name),
        enrichArtist: buildEnrichArtist(),
      })

  const resolved = await resolveArtistsByName(uniqueNames, {
    cache: nameCache,
    searchArtists: (name) => musicProvider.searchArtists(accessToken, name),
    enrichArtist: buildEnrichArtist(),
  })

  console.log(`[cache-search] hit=${resolved.cacheHits} miss=${resolved.cacheMisses} total=${uniqueNames.length}`)

  for (const [name, artist] of resolved.resolved) {
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

  const [{ data: listenedData }, { data: thumbsDownData }] = await Promise.all([
    supabase
      .from('listened_artists')
      .select('spotify_artist_id, lastfm_artist_name, play_count')
      .eq('user_id', userId),
    supabase
      .from('feedback')
      .select('spotify_artist_id')
      .eq('user_id', userId)
      .eq('signal', 'thumbs_down')
      .is('deleted_at', null),
  ])

  const overThresholdIds = new Set<string>()
  const overThresholdNames = new Set<string>()
  for (const row of listenedData ?? []) {
    if (row.play_count == null || row.play_count <= playThreshold) continue
    if (row.spotify_artist_id) {
      overThresholdIds.add(row.spotify_artist_id)
    } else if (row.lastfm_artist_name) {
      overThresholdNames.add(normalizeArtistName(row.lastfm_artist_name))
    }
  }

  const thumbsDownIds = new Set((thumbsDownData ?? []).map((r) => r.spotify_artist_id))
  let filtListened = 0

  const filteredCandidates = [...candidateMap.entries()]
    .filter(([id, val]) => {
      if (thumbsDownIds.has(id)) return false
      if (overThresholdIds.has(id)) { filtListened++; return false }
      if (overThresholdNames.has(normalizeArtistName(val.artist.name))) { filtListened++; return false }
      if (undergroundMode && (val.artist.popularity ?? 0) > UNDERGROUND_MAX_POPULARITY) return false
      if (genre && !val.artist.genres.some((g) => normalizedIncludes(g, genre))) return false
      return true
    })
    .map(([, val]) => val)

  const scored: ScoredArtist[] = filteredCandidates.map(({ artist, seedArtists }) => {
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
      artist: { ...artist, topTracks: [] },
      score,
      why: {
        sourceArtists: seedArtists.slice(0, 2),
        genres: artist.genres.slice(0, 2),
        friendBoost: [],
      },
      source,
    }
  })

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
      `filtListened=${filtListened} cands=${candidateMap.size} source=${source}`
    )
    return { count: 0, runSecondary: null }
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
      thumbsDownIds,
      overThresholdIds,
      overThresholdNames,
      fetchTagArtists: getTagArtistNames,
      resolveArtists: async (names) => {
        const r = await resolveArtistsByName(names, {
          cache: nameCache,
          searchArtists: (name) => musicProvider.searchArtists(accessToken, name),
          enrichArtist: buildEnrichArtist(),
        })
        return r.resolved
      },
    })
  }

  const topIds = top.map((item) => item.artist.id)
  const { data: existingCache } = await supabase
    .from('recommendation_cache')
    .select('spotify_artist_id, seen_at, skip_at')
    .eq('user_id', userId)
    .in('spotify_artist_id', topIds)

  const existingSeenAt = new Map<string, string | null>()
  const existingSkipAt = new Map<string, string | null>()
  for (const row of existingCache ?? []) {
    existingSeenAt.set(row.spotify_artist_id, row.seen_at)
    existingSkipAt.set(row.spotify_artist_id, row.skip_at)
  }

  const now = new Date()
  const expiresAt = new Date(now)
  expiresAt.setDate(expiresAt.getDate() + 30)

  const rows = top
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
        spotify_artist_id: item.artist.id,
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

  const { error } = rows.length === 0
    ? { error: null }
    : await supabase
        .from('recommendation_cache')
        .upsert(rows, { onConflict: 'user_id,spotify_artist_id' })

  if (error) {
    console.error(`[engine] upsert_error source=${source} err=${error.message}`)
    return { count: 0, runSecondary: null }
  }

  console.log(
    `[engine] OK seeds=${capSeedNames.length} lfm=${lfmTotal} uniq=${uniqueNames.length} ` +
    `ok=${resolved.searchOk} fail=${resolved.searchFail} filtListened=${filtListened} ` +
    `cands=${candidateMap.size} top=${top.length} written=${rows.length} source=${source}`
  )

  const writtenIds = new Set(rows.map((r) => r.spotify_artist_id))

  const runSecondary = secondaryResolvePromise === null
    ? null
    : async (): Promise<number> => {
        // Already fetched in parallel with primary — just await the result.
        const secondaryResolved = await secondaryResolvePromise

        const secondaryCandidates: Array<{ artist: Artist; seedArtists: string[] }> = []
        for (const [name, artist] of secondaryResolved.resolved) {
          if (writtenIds.has(artist.id)) continue
          if (thumbsDownIds.has(artist.id)) continue
          if (overThresholdIds.has(artist.id)) continue
          if (overThresholdNames.has(normalizeArtistName(artist.name))) continue
          if (undergroundMode && (artist.popularity ?? 0) > UNDERGROUND_MAX_POPULARITY) continue
          if (genre && !artist.genres.some((g) => normalizedIncludes(g, genre))) continue
          const seedArtists = nameToSeeds.get(name) ?? []
          secondaryCandidates.push({ artist, seedArtists })
        }

        if (secondaryCandidates.length === 0) {
          console.log(`[engine] secondary_empty source=${source}`)
          return 0
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
            artist: { ...artist, topTracks: [] },
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

        // Fetch existing cooldown state for secondary too — otherwise re-running
        // in the background can clobber a fresh seen_at/skip_at on an existing row.
        const secondaryIds = secondaryScored.map((s) => s.artist.id)
        const { data: existingSec } = await supabase
          .from('recommendation_cache')
          .select('spotify_artist_id, seen_at, skip_at')
          .eq('user_id', userId)
          .in('spotify_artist_id', secondaryIds)
        const secSeenAt = new Map<string, string | null>()
        const secSkipAt = new Map<string, string | null>()
        for (const row of existingSec ?? []) {
          secSeenAt.set(row.spotify_artist_id, row.seen_at)
          secSkipAt.set(row.spotify_artist_id, row.skip_at)
        }

        const secondaryRows = secondaryScored
          .filter((item) => {
            const seenAt = secSeenAt.get(item.artist.id)
            const skipAt = secSkipAt.get(item.artist.id)
            if (seenAt === undefined && skipAt === undefined) return true
            return isEligibleForCooldown(seenAt, skipAt, now)
          })
          .map((item) => {
            const previousSeenAt = secSeenAt.get(item.artist.id)
            const previousSkipAt = secSkipAt.get(item.artist.id)
            return {
              user_id: userId,
              spotify_artist_id: item.artist.id,
              artist_data: item.artist,
              score: item.score,
              why: item.why,
              source: item.source,
              expires_at: expiresAt.toISOString(),
              ...(previousSeenAt !== undefined ? { seen_at: previousSeenAt } : { seen_at: null }),
              ...(previousSkipAt !== undefined ? { skip_at: previousSkipAt } : { skip_at: null }),
            }
          })

        if (secondaryRows.length === 0) {
          console.log(`[engine] secondary_all_in_cooldown source=${source}`)
          return 0
        }

        const { error: secErr } = await supabase
          .from('recommendation_cache')
          .upsert(secondaryRows, { onConflict: 'user_id,spotify_artist_id' })

        if (secErr) {
          console.error(`[engine] secondary_upsert_error source=${source} err=${secErr.message}`)
          return 0
        }

        console.log(
          `[engine] secondary-OK source=${source} names=${secondaryNames.length} ` +
          `resolved=${secondaryResolved.resolved.size} written=${secondaryRows.length}`
        )
        return secondaryRows.length
      }

  return { count: rows.length, runSecondary }
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
  run: (opts: RunPipelineOpts) => Promise<BuildResult>
  coldStartSeeds: () => string[]
}

export async function runWithSoftening(
  baseOpts: RunPipelineOpts,
  deps: SoftenDeps
): Promise<BuildResult> {
  const primary = await deps.run(baseOpts)
  if (primary.count > 0) return primary

  const softened: SoftenedFilters = { playThreshold: false, coldStart: false }
  const originalPlayThreshold = baseOpts.playThreshold

  // Soften 1: bump play threshold.
  console.log(`[engine] soften_play_threshold userId=${baseOpts.userId} from=${originalPlayThreshold} to=${originalPlayThreshold + 5}`)
  softened.playThreshold = true
  const r1 = await deps.run({
    ...baseOpts,
    playThreshold: originalPlayThreshold + 5,
    source: 'soften_play_threshold',
  })
  if (r1.count > 0) return { ...r1, softenedFilters: softened }

  // Soften 2: cold-start fallback. undergroundMode is intentionally off here —
  // cold-start is the degenerate escape hatch for users with no seeds; its
  // curated starter picks are treated as an exception to the cap promise.
  console.log(`[engine] soften_cold_start userId=${baseOpts.userId}`)
  softened.coldStart = true
  const r3 = await deps.run({
    ...baseOpts,
    seedNames: deps.coldStartSeeds(),
    playThreshold: originalPlayThreshold + 5,
    undergroundMode: false,
    source: 'soften_cold_start',
    userGenres: [],
  })
  return { ...r3, softenedFilters: softened }
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
  return runPipeline(makeBaseOpts({ seedNames: coldSeeds, source: 'cold_start', userGenres: [] }))
}

function sampleColdStartSeeds(): string[] {
  const pool = [...coldStartData.seeds]
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[pool[i], pool[j]] = [pool[j], pool[i]]
  }
  return pool.slice(0, 5).map((s) => s.name)
}
