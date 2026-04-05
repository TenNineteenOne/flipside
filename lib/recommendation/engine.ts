import { musicProvider } from '@/lib/music-provider/provider'
import type { Artist } from '@/lib/music-provider/types'
import { createServiceClient } from '@/lib/supabase/server'
import type { RecommendationInput, ScoredArtist } from './types'

export async function buildRecommendations(input: RecommendationInput): Promise<number> {
  const { userId, accessToken } = input
  const supabase = createServiceClient()

  // ── Step 1: Get user's top artists ──────────────────────────────────────
  const [shortTerm, mediumTerm, longTerm] = await Promise.all([
    musicProvider.getTopArtists(accessToken, 'short_term'),
    musicProvider.getTopArtists(accessToken, 'medium_term'),
    musicProvider.getTopArtists(accessToken, 'long_term'),
  ])

  const topArtistMap = new Map<string, Artist>()
  for (const artist of [...shortTerm, ...mediumTerm, ...longTerm]) {
    if (!topArtistMap.has(artist.id)) {
      topArtistMap.set(artist.id, artist)
    }
  }

  if (topArtistMap.size === 0) {
    console.error('[engine] No top artists found')
    return 0
  }

  // ── Step 2: Collect unique genres from top artists ──────────────────────
  const genreCounts = new Map<string, number>()
  for (const artist of topArtistMap.values()) {
    for (const genre of artist.genres) {
      genreCounts.set(genre, (genreCounts.get(genre) ?? 0) + 1)
    }
  }

  // Sort genres by frequency (most common first) and take top 8
  const topGenres = [...genreCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([genre]) => genre)

  if (topGenres.length === 0) {
    console.error(`[engine] topArtists=${topArtistMap.size} but 0 genres found`)
    return 0
  }

  // ── Step 3: Search Spotify by genre to find new artists ─────────────────
  // Uses searchArtists which takes the user's access token (proven to work)
  const candidateMap = new Map<string, { artist: Artist; sourceGenres: string[] }>()

  const searchResults = await Promise.all(
    topGenres.map(async (genre) => {
      try {
        // Use genre: field filter without quotes (quotes can cause 0 results)
        const artists = await musicProvider.searchArtists(accessToken, `genre:${genre}`)
        return { genre, artists, error: null }
      } catch (err) {
        return { genre, artists: [] as Artist[], error: String(err) }
      }
    })
  )

  // Log all search results in one line (Vercel only shows first log per request)
  const searchSummary = searchResults.map(r => `${r.genre}:${r.artists.length}${r.error ? '!' : ''}`).join(' ')

  for (const { genre, artists } of searchResults) {
    for (const artist of artists) {
      // Skip if it's one of the user's top artists
      if (topArtistMap.has(artist.id)) continue

      if (candidateMap.has(artist.id)) {
        const existing = candidateMap.get(artist.id)!
        if (!existing.sourceGenres.includes(genre)) {
          existing.sourceGenres.push(genre)
        }
      } else {
        candidateMap.set(artist.id, { artist, sourceGenres: [genre] })
      }
    }
  }

  console.log(`[engine] top=${topArtistMap.size} genres=${topGenres.length} search=[${searchSummary}] candidates=${candidateMap.size}`)

  // ── Step 4: Filter — thumbs-down ──────────────────────────────────────
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

  // ── Step 5: Score candidates ──────────────────────────────────────────
  // Prefer: less popular (more obscure discovery), more genre overlap
  const scored: ScoredArtist[] = filteredCandidates.map(({ artist, sourceGenres }) => {
    // Lower popularity = higher discovery value (invert 0-100 scale)
    const discoveryScore = (100 - artist.popularity) / 100

    // More genre matches = more relevant
    const genreRelevance = Math.min(sourceGenres.length / 3, 1)

    const score = discoveryScore * 0.6 + genreRelevance * 0.4

    // Find which of the user's top artists share genres with this candidate
    const relatedTopArtists: string[] = []
    for (const topArtist of topArtistMap.values()) {
      if (topArtist.genres.some((g) => sourceGenres.includes(g))) {
        relatedTopArtists.push(topArtist.name)
        if (relatedTopArtists.length >= 2) break
      }
    }

    return {
      artist: { ...artist, topTracks: [] },
      score,
      why: {
        sourceArtists: relatedTopArtists,
        genres: sourceGenres.slice(0, 2),
        friendBoost: [],
      },
      source: 'genre_search',
    }
  })

  // ── Step 6: Sort and take top 20 ──────────────────────────────────────
  scored.sort((a, b) => b.score - a.score)
  const top = scored.slice(0, 20)

  if (top.length === 0) {
    console.error(`[engine] 0 scored candidates after filtering`)
    return 0
  }

  // ── Step 7: Fetch top tracks ──────────────────────────────────────────
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

  // ── Step 8: Write to cache ────────────────────────────────────────────
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
