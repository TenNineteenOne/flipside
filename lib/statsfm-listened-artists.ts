import { createServiceClient } from "@/lib/supabase/server"
import { resolveUnresolvedArtistIds } from "@/lib/listened-artists"

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
  /** Spotify access token — used for the ID resolution pass after upserting name-only rows. */
  accessToken: string
}): Promise<void> {
  const { userId, statsfmUsername, accessToken } = params

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
    await resolveUnresolvedArtistIds({ supabase, userId, accessToken })
  } catch (err) {
    console.error(
      "[accumulateStatsFmHistory] Resolution pass failed:",
      err instanceof Error ? err.message : err
    )
  }
}

async function batchUpsertStatsFmResolved(
  supabase: ReturnType<typeof createServiceClient>,
  userId: string,
  entries: ResolvedEntry[]
): Promise<void> {
  const now = new Date().toISOString()
  const ids = entries.map((e) => e.spotifyId)

  // Chunk the IN-list so stats.fm lifetime imports don't produce an oversized
  // WHERE clause. Chunks run in parallel; any chunk error aborts the pass.
  const CHUNK = 500
  const existingRows: Array<{ id: string; spotify_artist_id: string | null; play_count: number }> = []
  {
    const chunks: string[][] = []
    for (let i = 0; i < ids.length; i += CHUNK) chunks.push(ids.slice(i, i + CHUNK))
    const chunkResults = await Promise.all(
      chunks.map((chunk) =>
        supabase
          .from("listened_artists")
          .select("id, spotify_artist_id, play_count")
          .eq("user_id", userId)
          .in("spotify_artist_id", chunk)
      )
    )
    for (const { data, error } of chunkResults) {
      if (error) {
        console.error("[accumulateStatsFmHistory] Batch select error:", error.message)
        return
      }
      if (data) existingRows.push(...data)
    }
  }

  const existingMap = new Map<string, { id: string; play_count: number }>()
  for (const row of existingRows ?? []) {
    if (row.spotify_artist_id) {
      existingMap.set(row.spotify_artist_id, { id: row.id, play_count: row.play_count })
    }
  }

  const toInsert: Array<{
    user_id: string
    spotify_artist_id: string
    lastfm_artist_name: null
    source: string
    play_count: number
    last_seen_at: string
  }> = []
  const toUpdate: Array<{ id: string; play_count: number; last_seen_at: string }> = []

  for (const entry of entries) {
    const existing = existingMap.get(entry.spotifyId)
    if (existing) {
      toUpdate.push({ id: existing.id, play_count: existing.play_count + 1, last_seen_at: now })
    } else {
      toInsert.push({
        user_id: userId,
        spotify_artist_id: entry.spotifyId,
        lastfm_artist_name: null,
        source: "statsfm",
        play_count: 1,
        last_seen_at: now,
      })
    }
  }

  if (toInsert.length > 0) {
    const { error: insertError } = await supabase.from("listened_artists").insert(toInsert)
    if (insertError) {
      console.error("[accumulateStatsFmHistory] Batch insert (resolved) error:", insertError.message)
    }
  }
  if (toUpdate.length > 0) {
    const { error: updateError } = await supabase
      .from("listened_artists")
      .upsert(toUpdate, { onConflict: "id" })
    if (updateError) {
      console.error("[accumulateStatsFmHistory] Batch update (resolved) error:", updateError.message)
    }
  }

  console.log(
    `[accumulateStatsFmHistory] resolved batch insert=${toInsert.length} update=${toUpdate.length}`
  )
}

async function batchUpsertStatsFmNames(
  supabase: ReturnType<typeof createServiceClient>,
  userId: string,
  artistNames: string[]
): Promise<void> {
  const now = new Date().toISOString()

  // Chunk the IN-list (see batchUpsertStatsFmResolved above for rationale).
  const CHUNK = 500
  const existingRows: Array<{ id: string; lastfm_artist_name: string | null; play_count: number }> = []
  {
    const chunks: string[][] = []
    for (let i = 0; i < artistNames.length; i += CHUNK) chunks.push(artistNames.slice(i, i + CHUNK))
    const chunkResults = await Promise.all(
      chunks.map((chunk) =>
        supabase
          .from("listened_artists")
          .select("id, lastfm_artist_name, play_count")
          .eq("user_id", userId)
          .in("lastfm_artist_name", chunk)
      )
    )
    for (const { data, error } of chunkResults) {
      if (error) {
        console.error("[accumulateStatsFmHistory] Batch select (names) error:", error.message)
        return
      }
      if (data) existingRows.push(...data)
    }
  }

  const existingMap = new Map<string, { id: string; play_count: number }>()
  for (const row of existingRows ?? []) {
    if (row.lastfm_artist_name) {
      existingMap.set(row.lastfm_artist_name, { id: row.id, play_count: row.play_count })
    }
  }

  const toInsert: Array<{
    user_id: string
    spotify_artist_id: null
    lastfm_artist_name: string
    source: string
    play_count: number
    last_seen_at: string
  }> = []
  const toUpdate: Array<{ id: string; play_count: number; last_seen_at: string }> = []

  for (const name of artistNames) {
    const existing = existingMap.get(name)
    if (existing) {
      toUpdate.push({ id: existing.id, play_count: existing.play_count + 1, last_seen_at: now })
    } else {
      toInsert.push({
        user_id: userId,
        spotify_artist_id: null,
        lastfm_artist_name: name,
        source: "statsfm",
        play_count: 1,
        last_seen_at: now,
      })
    }
  }

  if (toInsert.length > 0) {
    const { error: insertError } = await supabase.from("listened_artists").insert(toInsert)
    if (insertError) {
      if (insertError.code === "23505") {
        for (const row of toInsert) {
          const { error: rowErr } = await supabase.from("listened_artists").insert(row)
          if (rowErr && rowErr.code !== "23505") {
            console.error("[accumulateStatsFmHistory] Row insert (names) error:", rowErr.message)
          }
        }
      } else {
        console.error("[accumulateStatsFmHistory] Batch insert (names) error:", insertError.message)
      }
    }
  }
  if (toUpdate.length > 0) {
    const { error: updateError } = await supabase
      .from("listened_artists")
      .upsert(toUpdate, { onConflict: "id" })
    if (updateError) {
      console.error("[accumulateStatsFmHistory] Batch update (names) error:", updateError.message)
    }
  }

  console.log(
    `[accumulateStatsFmHistory] names batch insert=${toInsert.length} update=${toUpdate.length}`
  )
}
