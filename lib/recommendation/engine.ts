import { musicProvider } from '@/lib/music-provider/provider'
import type { Artist } from '@/lib/music-provider/types'
import { createServiceClient } from '@/lib/supabase/server'
import type { RecommendationInput, ScoredArtist } from './types'
import { ArtistNameCache } from './artist-name-cache'
import { resolveArtistsByName } from './resolve-candidates'

/** Return the popularity-tier multiplier for a Spotify popularity value (0–100). */
function tierMultiplier(popularity: number): number {
  if (popularity <= 30) return 1.0
  if (popularity <= 60) return 0.25
  return 0.02
}

export async function buildRecommendations(input: RecommendationInput): Promise<number> {
  const { userId, accessToken, playThreshold } = input
  const supabase = createServiceClient()

  // ── Step 1: Get user's top artists (all 3 time ranges) ──────────────────
  const [shortTerm, mediumTerm, longTerm] = await Promise.all([
    musicProvider.getTopArtists(accessToken, 'short_term'),
    musicProvider.getTopArtists(accessToken, 'medium_term'),
    musicProvider.getTopArtists(accessToken, 'long_term'),
  ])

  const topArtistMap = new Map<string, Artist>()
  for (const artist of [...shortTerm, ...mediumTerm, ...longTerm]) {
    if (!topArtistMap.has(artist.id)) topArtistMap.set(artist.id, artist)
  }

  if (topArtistMap.size === 0) {
    console.error('[engine] FAIL no_top_artists')
    return 0
  }

  // ── Step 2: Pick 10 diverse seeds across all time ranges ────────────────
  // 4 from short, 4 from medium, 2 from long — avoids over-indexing on recent weeks
  const seenSeedIds = new Set<string>()
  const pickSeeds = (artists: Artist[], n: number): Artist[] => {
    const picked: Artist[] = []
    for (const a of artists) {
      if (picked.length >= n) break
      if (!seenSeedIds.has(a.id)) {
        seenSeedIds.add(a.id)
        picked.push(a)
      }
    }
    return picked
  }

  const seeds = [
    ...pickSeeds(shortTerm, 4),
    ...pickSeeds(mediumTerm, 4),
    ...pickSeeds(longTerm, 2),
  ]

  if (seeds.length === 0) {
    console.error('[engine] FAIL no_seeds')
    return 0
  }

  // ── Step 3: Fetch Last.fm names for all seeds IN PARALLEL ───────────────
  // No Spotify calls here — Last.fm is free, no auth, no rate limit.
  const topArtistNames = new Set([...topArtistMap.values()].map(a => a.name.toLowerCase()))

  const lfmResults = await Promise.all(
    seeds.map(async (seed) => ({
      seed,
      names: await musicProvider.getSimilarArtistNames(seed.name),
    }))
  )

  // ── Step 4: Deduplicate names across seeds, build name→seeds map ─────────
  // One Spotify search per unique name — not per seed × name.
  const nameToSeeds = new Map<string, string[]>()
  for (const { seed, names } of lfmResults) {
    for (const name of names) {
      if (topArtistNames.has(name.toLowerCase())) continue  // skip known artists by name
      if (!nameToSeeds.has(name)) nameToSeeds.set(name, [])
      nameToSeeds.get(name)!.push(seed.name)
    }
  }

  const uniqueNames = [...nameToSeeds.keys()]
  const lfmTotal = lfmResults.reduce((sum, r) => sum + r.names.length, 0)

  if (uniqueNames.length === 0) {
    console.error(`[engine] FAIL no_unique seeds=${seeds.length} lfm=${lfmTotal}`)
    return 0
  }

  // ── Step 5: Resolve unique names → Spotify artists (cache-first) ─────────
  // Hit the artist_search_cache table first; only live-search Spotify for misses.
  const candidateMap = new Map<string, { artist: Artist; seedArtists: string[] }>()

  const recentlyPlayed = await musicProvider.getRecentlyPlayed(accessToken)
  const recentIds = new Set(recentlyPlayed.map((r) => r.artistId))

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const nameCache = new ArtistNameCache(supabase as any)
  const resolved = await resolveArtistsByName(uniqueNames, {
    cache: nameCache,
    searchArtists: (name) => musicProvider.searchArtists(accessToken, name),
  })

  let filtTop = 0, filtRecent = 0
  for (const [name, artist] of resolved.resolved) {
    if (topArtistMap.has(artist.id)) { filtTop++; continue }
    if (recentIds.has(artist.id)) { filtRecent++; continue }
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
  const searchOk = resolved.searchOk
  const searchFail = resolved.searchFail
  console.log(`[cache-search] hit=${resolved.cacheHits} miss=${resolved.cacheMisses} total=${uniqueNames.length}`)

  // ── Step 5a: Filter — play threshold ─────────────────────────────────────
  // Exclude artists the user has listened to more times than playThreshold.
  // Artists with null play_count (unknown listen history) pass through.
  const { data: listenedData } = await supabase
    .from('listened_artists')
    .select('spotify_artist_id, play_count')
    .eq('user_id', userId)

  // Build a set of Spotify IDs that are over the threshold.
  const overThresholdIds = new Set<string>()
  for (const row of listenedData ?? []) {
    if (!row.spotify_artist_id) continue
    // null play_count → treat as unheard, pass through
    if (row.play_count != null && row.play_count > playThreshold) {
      overThresholdIds.add(row.spotify_artist_id)
    }
  }
  let filtListened = 0

  // ── Step 5b: Filter — thumbs-down ─────────────────────────────────────────
  const { data: thumbsDownData } = await supabase
    .from('feedback')
    .select('spotify_artist_id')
    .eq('user_id', userId)
    .eq('signal', 'thumbs_down')
    .is('deleted_at', null)

  const thumbsDownIds = new Set((thumbsDownData ?? []).map((r) => r.spotify_artist_id))

  const filteredCandidates = [...candidateMap.entries()]
    .filter(([id]) => {
      if (thumbsDownIds.has(id)) return false
      if (overThresholdIds.has(id)) { filtListened++; return false }
      return true
    })
    .map(([, val]) => val)

  // ── Step 6: Score — discovery curve + popularity tier multiplier ──────────
  // Power-of-2 curve: 80% weight on obscurity, 20% on seed relevance.
  // Then multiply by the tier weight to soft-rank underground artists first.
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
      source: 'lastfm_similar',
    }
  })

  scored.sort((a, b) => b.score - a.score)

  // ── Step 7: Take top 20 — no hard popularity cap ──────────────────────────
  // The tier multiplier already ensures underground artists rank first.
  // If fewer than 20 remain, return what's available.
  const top = scored.slice(0, 20)

  if (top.length === 0) {
    console.error(`[engine] FAIL zero_top seeds=${seeds.length} lfm=${lfmTotal} uniq=${uniqueNames.length} ok=${searchOk} fail=${searchFail} retries=${resolved.searchRetries} rateLimited=${resolved.rateLimited} budgetExhausted=${resolved.backoffBudgetExhausted} filtTop=${filtTop} filtRecent=${filtRecent} filtListened=${filtListened} cands=${candidateMap.size} scored=${scored.length}`)
    return 0
  }

  // ── Step 8: Write to cache ────────────────────────────────────────────────
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
      if (seenAt === undefined) return true   // never cached → fresh
      if (seenAt === null) return true         // cached but unseen → fresh
      // Allow re-recommendation after 7-day cooldown
      const seenDate = new Date(seenAt)
      const daysSinceSeen = (now.getTime() - seenDate.getTime()) / (1000 * 60 * 60 * 24)
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

  let written = 0
  if (rows.length > 0) {
    const { error } = await supabase
      .from('recommendation_cache')
      .upsert(rows, { onConflict: 'user_id,spotify_artist_id' })

    if (error) {
      console.error(`[engine] FAIL upsert_error seeds=${seeds.length} lfm=${lfmTotal} uniq=${uniqueNames.length} ok=${searchOk} fail=${searchFail} filtTop=${filtTop} filtRecent=${filtRecent} filtListened=${filtListened} cands=${candidateMap.size} top=${top.length} err=${error.message}`)
    } else {
      written = rows.length
    }
  }

  console.log(`[engine] OK seeds=${seeds.length} lfm=${lfmTotal} uniq=${uniqueNames.length} ok=${searchOk} fail=${searchFail} filtTop=${filtTop} filtRecent=${filtRecent} filtListened=${filtListened} cands=${candidateMap.size} top=${top.length} written=${written}`)
  return written
}
