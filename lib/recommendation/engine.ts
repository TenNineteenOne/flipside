import { musicProvider } from '@/lib/music-provider/provider'
import type { Artist } from '@/lib/music-provider/types'
import { createServiceClient } from '@/lib/supabase/server'
import { normalizeArtistName } from '@/lib/listened-artists'
import type { RecommendationInput, ScoredArtist } from './types'

export async function buildRecommendations(input: RecommendationInput): Promise<number> {
  const { userId, accessToken, playThreshold } = input
  const supabase = createServiceClient()

  // ── Step 1: Fetch top artists for all 3 terms ──────────────────────────────
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

  // ── Step 2: Seed fallback ──────────────────────────────────────────────────
  // If total top artists < 5, fetch seed_artists and include them.
  // Seeds are ignored entirely if top artists >= 10.
  const seedArtistMap = new Map<string, Artist>()
  if (topArtistMap.size < 10) {
    const { data: seeds } = await supabase
      .from('seed_artists')
      .select('spotify_artist_id, name, image_url')
      .eq('user_id', userId)

    if (seeds && topArtistMap.size < 5) {
      for (const seed of seeds) {
        if (!topArtistMap.has(seed.spotify_artist_id) && !seedArtistMap.has(seed.spotify_artist_id)) {
          seedArtistMap.set(seed.spotify_artist_id, {
            id: seed.spotify_artist_id,
            name: seed.name,
            genres: [],
            imageUrl: seed.image_url ?? null,
            popularity: 50,
          })
        }
      }
    }
  }

  // Combined source artists (top + seeds when applicable)
  const sourceArtistMap = new Map<string, Artist>([...topArtistMap, ...seedArtistMap])

  // ── Step 2b: Seed thumbs-up artists into source pool ─────────────────────
  // Artists the user has liked become seeds for getSimilarArtists expansion.
  // Two separate queries — no FK between feedback and recommendation_cache.
  const { data: thumbsUpRows } = await supabase
    .from('feedback')
    .select('spotify_artist_id')
    .eq('user_id', userId)
    .eq('signal', 'thumbs_up')
    .is('deleted_at', null)

  if (thumbsUpRows && thumbsUpRows.length > 0) {
    const thumbsUpIds = thumbsUpRows.map((r) => r.spotify_artist_id)
    const { data: cachedArtists } = await supabase
      .from('recommendation_cache')
      .select('spotify_artist_id, artist_data')
      .eq('user_id', userId)
      .in('spotify_artist_id', thumbsUpIds)

    for (const row of cachedArtists ?? []) {
      if (sourceArtistMap.has(row.spotify_artist_id)) continue
      if (row.artist_data) {
        sourceArtistMap.set(row.spotify_artist_id, row.artist_data as Artist)
      }
    }
  }

  // ── Step 3: Expand via getSimilarArtists ───────────────────────────────────
  // Track which source artist each candidate was found from
  const candidateMap = new Map<string, { artist: Artist; sourceArtists: string[]; degree: number }>()

  // Limit expansion to top 25 source artists to avoid Spotify rate limits.
  // More sources don't help if they all get rate-limited to 0 candidates.
  const sourceArtistsToExpand = Array.from(sourceArtistMap.values()).slice(0, 25)

  // Process in batches of 5 to keep concurrent Spotify search calls manageable
  const expansionResults: Array<{ sourceArtist: Artist; similar: Artist[]; degree: number }> = []
  for (let i = 0; i < sourceArtistsToExpand.length; i += 5) {
    const batch = sourceArtistsToExpand.slice(i, i + 5)
    const batchResults = await Promise.all(
      batch.map(async (sourceArtist) => {
        try {
          const similar = await musicProvider.getSimilarArtists(sourceArtist.id, sourceArtist.name, sourceArtist.genres)
          return { sourceArtist, similar, degree: 1 }
        } catch {
          return { sourceArtist, similar: [] as Artist[], degree: 1 }
        }
      })
    )
    expansionResults.push(...batchResults)
    // Early exit if we already have enough candidates
    const totalSoFar = expansionResults.reduce((s, r) => s + r.similar.length, 0)
    if (totalSoFar >= 200) break
  }

  console.log(`[engine] sourceArtists=${sourceArtistMap.size} expanded=${expansionResults.length} totalSimilar=${expansionResults.reduce((s, r) => s + r.similar.length, 0)}`)

  for (const { sourceArtist, similar, degree } of expansionResults) {
    for (const candidate of similar) {
      // Skip if it's already a source artist
      if (sourceArtistMap.has(candidate.id)) continue

      if (candidateMap.has(candidate.id)) {
        const existing = candidateMap.get(candidate.id)!
        if (!existing.sourceArtists.includes(sourceArtist.name)) {
          existing.sourceArtists.push(sourceArtist.name)
        }
      } else {
        candidateMap.set(candidate.id, {
          artist: candidate,
          sourceArtists: [sourceArtist.name],
          degree,
        })
      }

      if (candidateMap.size >= 200) break
    }
    if (candidateMap.size >= 200) break
  }

  console.log(`[engine] candidateMap.size=${candidateMap.size} after expansion`)

  // ── Step 4: Fetch thumbs-up and saved artists for scoring boosts ───────────
  const [feedbackData, savesData] = await Promise.all([
    supabase
      .from('feedback')
      .select('spotify_artist_id')
      .eq('user_id', userId)
      .eq('signal', 'thumbs_up')
      .is('deleted_at', null),
    supabase
      .from('saves')
      .select('spotify_artist_id')
      .eq('user_id', userId),
  ])

  const likedArtistIds = new Set<string>([
    ...((feedbackData.data ?? []).map((r) => r.spotify_artist_id)),
    ...((savesData.data ?? []).map((r) => r.spotify_artist_id)),
  ])

  // ── Step 5: Filter — history ───────────────────────────────────────────────
  const { data: listenedData } = await supabase
    .from('listened_artists')
    .select('spotify_artist_id, lastfm_artist_name, play_count')
    .eq('user_id', userId)

  const listenedBySpotifyId = new Map<string, number>()
  const listenedByNormalizedName = new Map<string, number>()

  for (const row of listenedData ?? []) {
    if (row.spotify_artist_id) {
      listenedBySpotifyId.set(row.spotify_artist_id, row.play_count)
    }
    if (row.lastfm_artist_name) {
      listenedByNormalizedName.set(normalizeArtistName(row.lastfm_artist_name), row.play_count)
    }
  }

  // ── Step 6: Filter — active thumbs-down ───────────────────────────────────
  const { data: thumbsDownData } = await supabase
    .from('feedback')
    .select('spotify_artist_id')
    .eq('user_id', userId)
    .eq('signal', 'thumbs_down')
    .is('deleted_at', null)

  const thumbsDownIds = new Set((thumbsDownData ?? []).map((r) => r.spotify_artist_id))

  // ── Step 7: Apply filters and score ───────────────────────────────────────
  const filteredCandidates: Array<{
    artist: Artist
    sourceArtists: string[]
    degree: number
  }> = []

  for (const [artistId, candidate] of candidateMap) {
    // Filter: active thumbs-down
    if (thumbsDownIds.has(artistId)) continue

    // Filter: history — only applies when threshold > 0
    // (0 = maximum discovery: include all candidates regardless of play history)
    if (playThreshold > 0) {
      const playCount = listenedBySpotifyId.get(artistId)
      if (playCount !== undefined && playCount > playThreshold) continue

      const normalizedName = normalizeArtistName(candidate.artist.name)
      const lfmPlayCount = listenedByNormalizedName.get(normalizedName)
      if (lfmPlayCount !== undefined && lfmPlayCount > playThreshold) continue
    }

    filteredCandidates.push(candidate)
  }

  // ── Step 8: Fetch groups and group_activity for group boost ────────────────
  const { data: groupMemberships } = await supabase
    .from('group_members')
    .select('group_id')
    .eq('user_id', userId)

  const groupIds = (groupMemberships ?? []).map((g) => g.group_id)

  // For each group, fetch all other members and their activity
  interface GroupMemberRow { user_id: string }
  interface GroupActivityRow {
    spotify_artist_id: string
    user_id: string
    group_id: string
    created_at: string
  }
  interface UserDisplayRow { id: string; display_name: string | null }

  let allGroupActivity: GroupActivityRow[] = []
  const memberDisplayNames = new Map<string, string>() // user_id -> display_name
  let groupSize = 0

  if (groupIds.length > 0) {
    const [activityResult, membersResult] = await Promise.all([
      supabase
        .from('group_activity')
        .select('spotify_artist_id, user_id, group_id, created_at')
        .in('group_id', groupIds)
        .neq('user_id', userId),
      supabase
        .from('group_members')
        .select('user_id')
        .in('group_id', groupIds)
        .neq('user_id', userId),
    ])

    allGroupActivity = (activityResult.data ?? []) as GroupActivityRow[]
    const memberIds = [...new Set(((membersResult.data ?? []) as GroupMemberRow[]).map((m) => m.user_id))]
    groupSize = memberIds.length

    if (memberIds.length > 0) {
      const { data: usersData } = await supabase
        .from('users')
        .select('id, display_name')
        .in('id', memberIds)

      for (const u of (usersData ?? []) as UserDisplayRow[]) {
        memberDisplayNames.set(u.id, u.display_name ?? 'A friend')
      }
    }
  }

  // Build a map: artistId -> { boostCount, friendNames }
  const groupBoostMap = new Map<string, { count: number; friends: string[] }>()
  for (const activity of allGroupActivity) {
    const entry = groupBoostMap.get(activity.spotify_artist_id) ?? { count: 0, friends: [] }
    entry.count += 1
    const name = memberDisplayNames.get(activity.user_id) ?? 'A friend'
    if (!entry.friends.includes(name)) {
      entry.friends.push(name)
    }
    groupBoostMap.set(activity.spotify_artist_id, entry)
  }

  // ── Step 9: Resurfacing from recommendation_cache ──────────────────────────
  const { data: seenCacheRows } = await supabase
    .from('recommendation_cache')
    .select('spotify_artist_id, seen_at')
    .eq('user_id', userId)
    .not('seen_at', 'is', null)

  // Re-include if ceil(groupSize * 0.2) other members reacted since seen_at
  const resurface = new Set<string>()
  if (seenCacheRows && groupSize > 0) {
    const requiredReactions = Math.ceil(groupSize * 0.2)
    for (const row of seenCacheRows) {
      const artistActivity = allGroupActivity.filter(
        (a) =>
          a.spotify_artist_id === row.spotify_artist_id &&
          row.seen_at !== null &&
          new Date(a.created_at) > new Date(row.seen_at)
      )
      const uniqueReactors = new Set(artistActivity.map((a) => a.user_id))
      if (uniqueReactors.size >= requiredReactions) {
        resurface.add(row.spotify_artist_id)
      }
    }
  }

  // Add resurfaced artists that aren't already in filteredCandidates
  const filteredIds = new Set(filteredCandidates.map((c) => c.artist.id))
  for (const artistId of resurface) {
    if (!filteredIds.has(artistId) && candidateMap.has(artistId)) {
      filteredCandidates.push(candidateMap.get(artistId)!)
    }
  }

  // ── Score each candidate ───────────────────────────────────────────────────
  const scored: ScoredArtist[] = []

  for (const candidate of filteredCandidates) {
    const { artist, sourceArtists, degree } = candidate

    // Base score from popularity
    let score = artist.popularity / 100

    // Relationship boost
    if (degree === 1) {
      score += 0.3
    } else {
      score += 0.2
    }

    // Thumbs-up / saved boost: related to any liked artist
    const relatedToLiked = sourceArtists.some((name) => {
      // Check if any source artist ID is in likedArtistIds
      for (const [id, a] of sourceArtistMap) {
        if (a.name === name && likedArtistIds.has(id)) return true
      }
      return false
    })
    if (relatedToLiked) {
      score += 0.2
    }

    // Group boost
    const groupBoost = groupBoostMap.get(artist.id)
    const friendBoost: string[] = []
    if (groupBoost) {
      score += groupBoost.count * 0.1
      friendBoost.push(...groupBoost.friends)
    }

    // Build why
    const why = {
      sourceArtists: sourceArtists.slice(0, 2),
      genres: artist.genres.slice(0, 2),
      friendBoost,
    }

    scored.push({ artist: { ...artist, topTracks: [] }, score, why, source: 'spotify_recommendations' })
  }

  // ── Step 10: Sort and take top 50 ─────────────────────────────────────────
  scored.sort((a, b) => b.score - a.score)
  const top50 = scored.slice(0, 50)

  // ── Step 11: Fetch top tracks for each artist (batched to avoid rate limits)
  // market param is required by Spotify — get user's actual country first
  const userMarket = await (musicProvider as any).getUserMarket?.(accessToken) ?? "US"

  const withTracks: typeof top50 = []
  const TRACK_BATCH = 5
  for (let i = 0; i < top50.length; i += TRACK_BATCH) {
    const batch = top50.slice(i, i + TRACK_BATCH)
    const results = await Promise.all(
      batch.map(async (item) => {
        try {
          const tracks = await musicProvider.getArtistTopTracks(accessToken, item.artist.id, 10, userMarket)
          return { ...item, artist: { ...item.artist, topTracks: tracks.slice(0, 10) } }
        } catch {
          return item
        }
      })
    )
    withTracks.push(...results)
  }

  // ── Step 12: why field is already built above ──────────────────────────────

  // ── Step 13: Write to recommendation_cache ─────────────────────────────────
  // Fetch existing seen_at values to preserve them
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

  let written = 0

  for (const item of withTracks) {
    const artistId = item.artist.id
    const existingSeen = existingSeenAt.get(artistId)

    // Don't overwrite items the user has already seen
    if (existingSeen !== undefined && existingSeen !== null) continue

    const { error } = await supabase
      .from('recommendation_cache')
      .upsert(
        {
          user_id: userId,
          spotify_artist_id: artistId,
          artist_data: item.artist,
          score: item.score,
          why: item.why,
          source: item.source,
          expires_at: expiresAt.toISOString(),
          seen_at: null,
        },
        { onConflict: 'user_id,spotify_artist_id' }
      )

    if (error) {
      console.error('[buildRecommendations] Upsert error for artist:', artistId, error.message)
    } else {
      written++
    }
  }

  // ── Step 14: Expire old seen entries ──────────────────────────────────────
  const sevenDaysAgo = new Date(now)
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7)

  await supabase
    .from('recommendation_cache')
    .update({ expires_at: now.toISOString() })
    .eq('user_id', userId)
    .not('seen_at', 'is', null)
    .lt('seen_at', sevenDaysAgo.toISOString())

  return written
}
