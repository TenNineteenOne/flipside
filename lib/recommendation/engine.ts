import { musicProvider } from '@/lib/music-provider/provider'
import type { Artist } from '@/lib/music-provider/types'
import { createServiceClient } from '@/lib/supabase/server'
import type { RecommendationInput, ScoredArtist } from './types'
import { ArtistNameCache } from './artist-name-cache'
import { resolveArtistsByName } from './resolve-candidates'
import coldStartData from '@/data/cold-start-seeds.json'

const LASTFM_BASE = "http://ws.audioscrobbler.com/2.0"

/** Return the popularity-tier multiplier for a Spotify popularity value (0–100). */
function tierMultiplier(popularity: number): number {
  if (popularity <= 30) return 1.0
  if (popularity <= 60) return 0.25
  return 0.02
}

/** Fetch artist names for a Last.fm genre tag. */
async function getTagArtistNames(tag: string): Promise<string[]> {
  const apiKey = process.env.LASTFM_API_KEY
  if (!apiKey) return []
  try {
    const url =
      `${LASTFM_BASE}/?method=tag.gettopartists` +
      `&tag=${encodeURIComponent(tag)}&api_key=${apiKey}&format=json&limit=20`
    const res = await fetch(url)
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

  // Gather genre tag artists from Last.fm
  const genres = (userRow?.selected_genres as string[] | null) ?? []
  if (genres.length > 0) {
    const genreResults = await Promise.all(genres.map(getTagArtistNames))
    for (const batch of genreResults) names.push(...batch)
  }

  // Deduplicate
  return [...new Set(names)]
}

// ── Core pipeline ───────────────────────────────────────────────────────────

async function runPipeline(
  seedNames: string[],
  accessToken: string,
  userId: string,
  playThreshold: number,
  supabase: SupabaseClient,
  source: string
): Promise<number> {
  const capSeedNames = seedNames.slice(0, 10)

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

  const uniqueNames = [...nameToSeeds.keys()]
  const lfmTotal = lfmResults.reduce((sum, r) => sum + r.names.length, 0)

  if (uniqueNames.length === 0) {
    console.error(`[engine] FAIL no_unique seeds=${capSeedNames.length} lfm=${lfmTotal} source=${source}`)
    return 0
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

  // Step C: Filter — play threshold
  const { data: listenedData } = await supabase
    .from('listened_artists')
    .select('spotify_artist_id, play_count')
    .eq('user_id', userId)

  const overThresholdIds = new Set<string>()
  for (const row of listenedData ?? []) {
    if (!row.spotify_artist_id) continue
    if (row.play_count != null && row.play_count > playThreshold) {
      overThresholdIds.add(row.spotify_artist_id)
    }
  }

  // Step C2: Filter — thumbs-down
  const { data: thumbsDownData } = await supabase
    .from('feedback')
    .select('spotify_artist_id')
    .eq('user_id', userId)
    .eq('signal', 'thumbs_down')
    .is('deleted_at', null)

  const thumbsDownIds = new Set((thumbsDownData ?? []).map((r) => r.spotify_artist_id))
  let filtListened = 0

  const filteredCandidates = [...candidateMap.entries()]
    .filter(([id]) => {
      if (thumbsDownIds.has(id)) return false
      if (overThresholdIds.has(id)) { filtListened++; return false }
      return true
    })
    .map(([, val]) => val)

  // Step D: Score
  const scored: ScoredArtist[] = filteredCandidates.map(({ artist, seedArtists }) => {
    const discoveryScore = Math.pow((100 - artist.popularity) / 100, 2)
    const seedRelevance = Math.min(seedArtists.length / 3, 1)
    const baseScore = discoveryScore * 0.80 + seedRelevance * 0.20
    const score = baseScore * tierMultiplier(artist.popularity)

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
  const top = scored.slice(0, 20)

  if (top.length === 0) {
    console.error(
      `[engine] FAIL zero_top seeds=${capSeedNames.length} lfm=${lfmTotal} ` +
      `uniq=${uniqueNames.length} ok=${resolved.searchOk} fail=${resolved.searchFail} ` +
      `filtListened=${filtListened} cands=${candidateMap.size} source=${source}`
    )
    return 0
  }

  // Step E: Write to cache
  const { data: existingCache } = await supabase
    .from('recommendation_cache')
    .select('spotify_artist_id, seen_at')
    .eq('user_id', userId)

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
    .map((item) => ({
      user_id: userId,
      spotify_artist_id: item.artist.id,
      artist_data: item.artist,
      score: item.score,
      why: item.why,
      source: item.source,
      expires_at: expiresAt.toISOString(),
      seen_at: null,
    }))

  if (rows.length === 0) return 0

  const { error } = await supabase
    .from('recommendation_cache')
    .upsert(rows, { onConflict: 'user_id,spotify_artist_id' })

  if (error) {
    console.error(`[engine] upsert_error source=${source} err=${error.message}`)
    return 0
  }

  console.log(
    `[engine] OK seeds=${capSeedNames.length} lfm=${lfmTotal} uniq=${uniqueNames.length} ` +
    `ok=${resolved.searchOk} fail=${resolved.searchFail} filtListened=${filtListened} ` +
    `cands=${candidateMap.size} top=${top.length} written=${rows.length} source=${source}`
  )
  return rows.length
}

// ── Main entry point ────────────────────────────────────────────────────────

export async function buildRecommendations(input: RecommendationInput): Promise<number> {
  const { userId, accessToken, playThreshold } = input
  const supabase = createServiceClient()

  // Gather seeds from all configured sources
  const seedNames = await gatherSeedNames(userId, supabase)

  if (seedNames.length > 0) {
    console.log(`[engine] start userId=${userId} seeds=${seedNames.length}`)
    return runPipeline(seedNames, accessToken, userId, playThreshold, supabase, 'multi_source')
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
  return runPipeline(coldSeeds, accessToken, userId, playThreshold, supabase, 'cold_start')
}
