import { musicProvider } from '@/lib/music-provider/provider'
import type { Artist } from '@/lib/music-provider/types'
import { createServiceClient } from '@/lib/supabase/server'
import type { BuildResult, RecommendationInput, ScoredArtist } from './types'
import { ArtistNameCache } from './artist-name-cache'
import { resolveArtistsByName } from './resolve-candidates'
import { normalizeArtistName } from '@/lib/listened-artists'
import coldStartData from '@/data/cold-start-seeds.json'

const LASTFM_BASE = "https://ws.audioscrobbler.com/2.0"

/**
 * Return the popularity-tier multiplier for a Spotify popularity value (0–100).
 * `curveK` is the base of the exponential (users.popularity_curve). Smaller =
 * steeper = stronger obscurity preference. Defaults to 0.95 for callers that
 * haven't been plumbed through yet.
 */
export function tierMultiplier(popularity: number, curveK = 0.95): number {
  return Math.pow(curveK, popularity)
}

/** Fetch artist names for a Last.fm genre tag. */
async function getTagArtistNames(tag: string): Promise<string[]> {
  const apiKey = process.env.LASTFM_API_KEY
  if (!apiKey) return []
  try {
    const url =
      `${LASTFM_BASE}/?method=tag.gettopartists` +
      `&tag=${encodeURIComponent(tag)}&api_key=${apiKey}&format=json&limit=20`
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

// ── Seed gathering ──────────────────────────────────────────────────────────

type SupabaseClient = ReturnType<typeof createServiceClient>

async function gatherSeedNames(userId: string, supabase: SupabaseClient): Promise<string[]> {
  const [dbSeeds, thumbsUpRows, userRow] = await Promise.all([
    supabase
      .from('seed_artists')
      .select('name')
      .eq('user_id', userId)
      .then(({ data }) => (data ?? []).map((r) => r.name as string).filter(Boolean)),

    supabase
      .from('feedback')
      .select('spotify_artist_id')
      .eq('user_id', userId)
      .eq('signal', 'thumbs_up')
      .is('deleted_at', null)
      .limit(10)
      .then(({ data }) => (data ?? []).map((r) => r.spotify_artist_id as string).filter(Boolean)),

    supabase
      .from('users')
      .select('selected_genres')
      .eq('id', userId)
      .maybeSingle()
      .then(({ data }) => data),
  ])

  const names: string[] = [...dbSeeds]

  // Resolve thumbs-up artist IDs to names via recommendation_cache
  if (thumbsUpRows.length > 0) {
    const { data: cached } = await supabase
      .from('recommendation_cache')
      .select('artist_data')
      .eq('user_id', userId)
      .in('spotify_artist_id', thumbsUpRows)
    for (const row of cached ?? []) {
      const name = (row.artist_data as { name?: string })?.name
      if (name) names.push(name)
    }
  }

  // Gather genre tag artists from Last.fm (cap at 5 to avoid rate limiting)
  const genres = ((userRow?.selected_genres as string[] | null) ?? []).slice(0, 5)
  if (genres.length > 0) {
    const genreResults = await Promise.all(genres.map(getTagArtistNames))
    for (const batch of genreResults) names.push(...batch)
  }

  console.log(
    `[engine] gather userId=${userId} selected_genres=${JSON.stringify(genres)} ` +
    `dbSeeds=${dbSeeds.length} thumbsUp=${thumbsUpRows.length} totalPooled=${names.length}`
  )

  // Deduplicate then shuffle (Fisher–Yates) so each generation surfaces a
  // different mix of sources — prevents any single over-fertile seed source
  // (a popular genre's Last.fm tag list) from monopolizing the 10-slice below.
  const deduped = [...new Set(names)]
  for (let i = deduped.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[deduped[i], deduped[j]] = [deduped[j], deduped[i]]
  }
  return deduped
}

// ── Core pipeline ───────────────────────────────────────────────────────────

// Primary/secondary split: resolve this many names on the critical path
// (blocks the response), resolve the rest in the background via runSecondary.
const PRIMARY_RESOLVE_CAP = 20
const SECONDARY_RESOLVE_CAP = 30

async function runPipeline(
  seedNames: string[],
  accessToken: string,
  userId: string,
  playThreshold: number,
  popularityCurve: number,
  supabase: SupabaseClient,
  source: string,
  genre?: string,
  undergroundMode?: boolean
): Promise<BuildResult> {
  const capSeedNames = seedNames.slice(0, 10)
  console.log(`[engine] seeds-post-shuffle source=${source} seeds=${JSON.stringify(capSeedNames)}`)

  // Step A: Fetch Last.fm similar artists for all seeds in parallel
  const lfmResults = await Promise.all(
    capSeedNames.map(async (name) => ({
      seed: name,
      names: await musicProvider.getSimilarArtistNames(name),
    }))
  )

  const knownNames = new Set(capSeedNames.map((n) => n.toLowerCase()))
  const nameToSeeds = new Map<string, string[]>()
  for (const { seed, names } of lfmResults) {
    for (const name of names) {
      if (knownNames.has(name.toLowerCase())) continue
      if (!nameToSeeds.has(name)) nameToSeeds.set(name, [])
      nameToSeeds.get(name)!.push(seed)
    }
  }

  // Split: first chunk resolves synchronously (20), second chunk runs in after()
  const allNames = [...nameToSeeds.keys()]
  const uniqueNames = allNames.slice(0, PRIMARY_RESOLVE_CAP)
  const secondaryNames = allNames.slice(PRIMARY_RESOLVE_CAP, PRIMARY_RESOLVE_CAP + SECONDARY_RESOLVE_CAP)
  const lfmTotal = lfmResults.reduce((sum, r) => sum + r.names.length, 0)

  if (uniqueNames.length === 0) {
    console.error(`[engine] FAIL no_unique seeds=${capSeedNames.length} lfm=${lfmTotal} source=${source}`)
    return { count: 0, runSecondary: null }
  }

  // Step B: Resolve names → Spotify artists (cache-first)
  const candidateMap = new Map<string, { artist: Artist; seedArtists: string[] }>()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const nameCache = new ArtistNameCache(supabase as any)
  const resolved = await resolveArtistsByName(uniqueNames, {
    cache: nameCache,
    searchArtists: (name) => musicProvider.searchArtists(accessToken, name),
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

  // Step C: Filter — play threshold + thumbs-down (parallel)
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
  // Also match by normalized name — Last.fm/stats.fm rows with a null
  // spotify_artist_id (resolver hasn't run yet, or the name didn't match
  // Spotify's catalog) would otherwise slip past this filter entirely.
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
      // Genre filter: only include artists matching the requested genre
      if (genre && !val.artist.genres.some((g) => g.toLowerCase().includes(genre.toLowerCase()))) return false
      return true
    })
    .map(([, val]) => val)

  // Step D: Score
  const scored: ScoredArtist[] = filteredCandidates.map(({ artist, seedArtists }) => {
    // Diminishing-returns seedRelevance: sqrt curve instead of linear/3.
    // Reduces compounding when one artist appears in many seeds' similar
    // lists — a 3-match candidate no longer blows past a 1-match.
    const seedRelevance = Math.min(Math.sqrt(seedArtists.length) / Math.sqrt(6), 1)
    const tier = tierMultiplier(artist.popularity, popularityCurve)
    // Underground mode: apply additional discoveryScore penalty for extra obscurity
    const discoveryPenalty = undergroundMode
      ? Math.pow((100 - artist.popularity) / 100, 2)
      : 1
    const baseScore = tier * 0.80 + seedRelevance * 0.20
    const score = baseScore * discoveryPenalty

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

  // Soft genre novelty: greedy selection with a small penalty per existing
  // rep of a genre. Not a hard cap — if the entire candidate pool is one
  // genre, all slots still fill. Only kicks in when the pool is diverse.
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

  const top: ScoredArtist[] = []
  const genreCounts = new Map<string, number>()
  while (top.length < 20 && pool.length > 0) {
    let bestIdx = 0
    let bestAdjusted = -Infinity
    for (let i = 0; i < pool.length; i++) {
      const primary = pool[i].artist.genres[0] ?? "unknown"
      const count = genreCounts.get(primary) ?? 0
      const adjusted = pool[i].score - count * 0.02
      if (adjusted > bestAdjusted) {
        bestAdjusted = adjusted
        bestIdx = i
      }
    }
    const picked = pool.splice(bestIdx, 1)[0]
    const primary = picked.artist.genres[0] ?? "unknown"
    genreCounts.set(primary, (genreCounts.get(primary) ?? 0) + 1)
    top.push(picked)
  }

  if (top.length === 0) {
    console.error(
      `[engine] FAIL zero_top seeds=${capSeedNames.length} lfm=${lfmTotal} ` +
      `uniq=${uniqueNames.length} ok=${resolved.searchOk} fail=${resolved.searchFail} ` +
      `filtListened=${filtListened} cands=${candidateMap.size} source=${source}`
    )
    return { count: 0, runSecondary: null }
  }

  // Step E: Write to cache — only check cooldown for artists we're about to write
  const topIds = top.map((item) => item.artist.id)
  const { data: existingCache } = await supabase
    .from('recommendation_cache')
    .select('spotify_artist_id, seen_at')
    .eq('user_id', userId)
    .in('spotify_artist_id', topIds)

  const existingSeenAt = new Map<string, string | null>()
  for (const row of existingCache ?? []) {
    existingSeenAt.set(row.spotify_artist_id, row.seen_at)
  }

  const now = new Date()
  const expiresAt = new Date(now)
  expiresAt.setDate(expiresAt.getDate() + 30)

  const rows = top
    .filter((item) => {
      const seenAt = existingSeenAt.get(item.artist.id)
      if (seenAt === undefined) return true
      if (seenAt === null) return true
      // Allow re-recommendation after 7-day cooldown
      const daysSinceSeen = (now.getTime() - new Date(seenAt).getTime()) / (1000 * 60 * 60 * 24)
      return daysSinceSeen >= 7
    })
    .map((item) => {
      const previousSeenAt = existingSeenAt.get(item.artist.id)
      return {
        user_id: userId,
        spotify_artist_id: item.artist.id,
        artist_data: item.artist,
        score: item.score,
        why: item.why,
        source: item.source,
        expires_at: expiresAt.toISOString(),
        // Preserve existing seen_at to maintain 7-day cooldown integrity
        ...(previousSeenAt !== undefined ? { seen_at: previousSeenAt } : { seen_at: null }),
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

  const runSecondary = secondaryNames.length === 0
    ? null
    : async (): Promise<number> => {
        const secondaryResolved = await resolveArtistsByName(secondaryNames, {
          cache: nameCache,
          searchArtists: (name) => musicProvider.searchArtists(accessToken, name),
        })

        const secondaryCandidates: Array<{ artist: Artist; seedArtists: string[] }> = []
        for (const [name, artist] of secondaryResolved.resolved) {
          if (writtenIds.has(artist.id)) continue
          if (thumbsDownIds.has(artist.id)) continue
          if (overThresholdIds.has(artist.id)) continue
          if (overThresholdNames.has(normalizeArtistName(artist.name))) continue
          if (genre && !artist.genres.some((g) => g.toLowerCase().includes(genre.toLowerCase()))) continue
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
          const score = baseScore * discoveryPenalty
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

        const secondaryRows = secondaryScored.map((item) => ({
          user_id: userId,
          spotify_artist_id: item.artist.id,
          artist_data: item.artist,
          score: item.score,
          why: item.why,
          source: item.source,
          expires_at: expiresAt.toISOString(),
          seen_at: null,
        }))

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

export async function buildRecommendations(input: RecommendationInput): Promise<BuildResult> {
  const { userId, accessToken, playThreshold, popularityCurve, genre, undergroundMode } = input
  const supabase = createServiceClient()

  // Gather seeds from all configured sources
  const seedNames = await gatherSeedNames(userId, supabase)

  if (seedNames.length > 0) {
    console.log(`[engine] start userId=${userId} seeds=${seedNames.length}${genre ? ` genre=${genre}` : ""}`)
    return runPipeline(seedNames, accessToken, userId, playThreshold, popularityCurve, supabase, 'multi_source', genre, undergroundMode)
  }

  // Cold-start: no seeds configured — pick random artists from curated list
  console.log(`[engine] cold_start userId=${userId}`)
  const pool = [...coldStartData.seeds]
  // Shuffle and pick 5
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[pool[i], pool[j]] = [pool[j], pool[i]]
  }
  const coldSeeds = pool.slice(0, 5).map((s) => s.name)
  return runPipeline(coldSeeds, accessToken, userId, playThreshold, popularityCurve, supabase, 'cold_start', genre, undergroundMode)
}
