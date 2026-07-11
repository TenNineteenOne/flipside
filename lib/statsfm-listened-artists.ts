import { createServiceClient } from "@/lib/supabase/server"
import { resolveUnresolvedArtistIds } from "@/lib/history/id-resolver"
import { ensureArtists, type ArtistsSupabaseClient } from "@/lib/artists"
import { upsertListenedArtists } from "@/lib/history/listened-upsert"

interface StatsFmArtist {
  id: number
  name: string
  spotifyIds?: string[]
}

interface StatsFmTopArtistItem {
  position?: number
  streams?: number
  playedMs?: number
  artist: StatsFmArtist
}

interface StatsFmTopArtistsResponse {
  items?: StatsFmTopArtistItem[]
}

interface ResolvedEntry {
  spotifyId: string
  name: string
}

export async function accumulateStatsFmHistory(params: {
  userId: string
  statsfmUsername: string
}): Promise<void> {
  const { userId, statsfmUsername } = params

  const url = `https://api.stats.fm/api/v1/users/${encodeURIComponent(statsfmUsername)}/top/artists?range=lifetime`
  const res = await fetch(url, { signal: AbortSignal.timeout(8000) })

  if (!res.ok) {
    throw new Error(`Failed to fetch stats.fm top artists (HTTP ${res.status})`)
  }

  const data = (await res.json()) as StatsFmTopArtistsResponse
  const items = data.items ?? []

  const resolved: ResolvedEntry[] = []
  const unresolvedNames = new Set<string>()

  for (const item of items) {
    const name = item.artist?.name?.trim()
    if (!name) continue
    const sid = item.artist.spotifyIds?.[0]
    if (sid) {
      resolved.push({ spotifyId: sid, name })
    } else {
      unresolvedNames.add(name)
    }
  }

  const supabase = createServiceClient()

  if (resolved.length > 0) {
    await batchUpsertStatsFmResolved(supabase, userId, resolved)
  }
  if (unresolvedNames.size > 0) {
    await batchUpsertStatsFmNames(supabase, userId, [...unresolvedNames])
  }

  try {
    await resolveUnresolvedArtistIds({ supabase, userId })
  } catch (err) {
    console.error(
      "[accumulateStatsFmHistory] Resolution pass failed:",
      err instanceof Error ? err.message : err
    )
  }
}

// Chunk the existing-rows SELECT's IN-list so stats.fm lifetime imports don't
// produce an oversized WHERE clause.
const CHUNK = 500

async function batchUpsertStatsFmResolved(
  supabase: ReturnType<typeof createServiceClient>,
  userId: string,
  entries: ResolvedEntry[]
): Promise<void> {
  // Mint/resolve each incoming Spotify id → canonical artists.id (uuid).
  const idMap = await ensureArtists(
    supabase as unknown as ArtistsSupabaseClient,
    entries.map((e) => ({ spotifyId: e.spotifyId, name: e.name }))
  )
  const uuids = [...new Set([...idMap.values()])]
  if (uuids.length === 0) {
    console.log("[accumulateStatsFmHistory] resolved batch no uuids minted")
    return
  }

  await upsertListenedArtists({
    supabase,
    userId,
    keys: uuids,
    keyColumn: "artist_id",
    source: "statsfm",
    chunkSize: CHUNK,
    // Concurrent Spotify sync may insert the same (user_id, artist_id) first;
    // recover per-row instead of dropping the batch (0041 restored the unique).
    conflictFallback: true,
    logPrefix: "[accumulateStatsFmHistory]",
    logLabel: "resolved batch",
    errorSuffix: " (resolved)",
  })
}

async function batchUpsertStatsFmNames(
  supabase: ReturnType<typeof createServiceClient>,
  userId: string,
  artistNames: string[]
): Promise<void> {
  await upsertListenedArtists({
    supabase,
    userId,
    keys: artistNames,
    keyColumn: "lastfm_artist_name",
    source: "statsfm",
    chunkSize: CHUNK,
    conflictFallback: true,
    logPrefix: "[accumulateStatsFmHistory]",
    logLabel: "names batch",
    errorSuffix: " (names)",
    selectErrorSuffix: " (names)",
  })
}
