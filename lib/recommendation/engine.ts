import { musicProvider } from '@/lib/music-provider/provider'
import type { Artist } from '@/lib/music-provider/types'
import { createServiceClient } from '@/lib/supabase/server'
import type { RecommendationInput, ScoredArtist } from './types'

export async function buildRecommendations(input: RecommendationInput): Promise<number> {
  const { userId, accessToken } = input
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
    console.error('[engine] No top artists found')
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
    console.error('[engine] No seeds available')
    return 0
  }

  // ── Step 3: Get recently played to add to exclusion set ─────────────────
  const recentlyPlayed = await musicProvider.getRecentlyPlayed(accessToken)
  const recentIds = new Set(recentlyPlayed.map((r) => r.artistId))

  // ── Step 4: Get Last.fm similar artists for each seed ───────────────────
  const candidateMap = new Map<string, { artist: Artist; seedArtists: string[] }>()

  const similarResults = await Promise.all(
    seeds.map(async (seed) => {
      try {
        const similar = await musicProvider.getSimilarArtists(
          accessToken, seed.id, seed.name, seed.genres
        )
        return { seed, similar, error: null }
      } catch (err) {
        return { seed, similar: [] as Artist[], error: String(err) }
      }
    })
  )

  for (const { seed, similar } of similarResults) {
    for (const artist of similar) {
      // Exclude top artists and recently played
      if (topArtistMap.has(artist.id)) continue
      if (recentIds.has(artist.id)) continue

      if (candidateMap.has(artist.id)) {
        const existing = candidateMap.get(artist.id)!
        if (!existing.seedArtists.includes(seed.name)) {
          existing.seedArtists.push(seed.name)
        }
      } else {
        candidateMap.set(artist.id, { artist, seedArtists: [seed.name] })
      }
    }
  }

  const searchSummary = similarResults
    .map(r => `${r.seed.name.slice(0, 12)}:${r.similar.length}${r.error ? '!' : ''}`)
    .join(' ')

  // ── Step 5: Filter — thumbs-down ─────────────────────────────────────────
  const { data: thumbsDownData } = await supabase
    .from('feedback')
    .select('spotify_artist_id')
    .eq('user_id', userId)
    .eq('signal', 'thumbs_down')
    .is('deleted_at', null)

  const thumbsDownIds = new Set((thumbsDownData ?? []).map((r) => r.spotify_artist_id))

  const filteredCandidates = [...candidateMap.entries()]
    .filter(([id]) => !thumbsDownIds.has(id))
    .map(([, val]) => val)

  // ── Step 6: Score — aggressive discovery curve ───────────────────────────
  // Power-of-2 curve crushes mid/high popularity; 80% weight on obscurity
  const scored: ScoredArtist[] = filteredCandidates.map(({ artist, seedArtists }) => {
    const discoveryScore = Math.pow((100 - artist.popularity) / 100, 2)
    const seedRelevance = Math.min(seedArtists.length / 3, 1)
    const score = discoveryScore * 0.80 + seedRelevance * 0.20

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

  // ── Step 7: Tiered popularity cap — target underground (pop ≤ 55) ────────
  let capLabel = 'none'
  let top: ScoredArtist[]

  const capped55 = scored.filter(s => s.artist.popularity <= 55)
  const capped65 = scored.filter(s => s.artist.popularity <= 65)

  if (capped55.length >= 5) {
    top = capped55.slice(0, 20)
    capLabel = '55'
  } else if (capped65.length >= 5) {
    top = capped65.slice(0, 20)
    capLabel = '65'
  } else {
    top = scored.slice(0, 20)
  }

  console.log(`[engine] top=${topArtistMap.size} seeds=${seeds.length} similar=[${searchSummary}] candidates=${candidateMap.size} cap=${capLabel} written=${top.length}`)

  if (top.length === 0) {
    console.error('[engine] 0 candidates after all filtering')
    return 0
  }

  // ── Step 8: Fetch top tracks ──────────────────────────────────────────────
  const userMarket = await musicProvider.getUserMarket(accessToken)

  const withTracks = await Promise.all(
    top.map(async (item) => {
      try {
        const tracks = await musicProvider.getArtistTopTracks(accessToken, item.artist.id, 10, userMarket)
        return { ...item, artist: { ...item.artist, topTracks: tracks.slice(0, 10) } }
      } catch {
        return item
      }
    })
  )

  // ── Step 9: Write to cache ────────────────────────────────────────────────
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

  const rows = withTracks
    .filter((item) => {
      const seen = existingSeenAt.get(item.artist.id)
      return seen === undefined || seen === null
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
      console.error('[engine] Batch upsert error:', error.message)
    } else {
      written = rows.length
    }
  }

  return written
}
