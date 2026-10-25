import { createServiceClient } from "@/lib/supabase/server"
import { ingestListens, type Listen } from "@/lib/history/ingest"

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

  const listens: Listen[] = []
  for (const item of items) {
    const name = item.artist?.name?.trim()
    if (!name) continue
    listens.push({ name, spotifyId: item.artist.spotifyIds?.[0] || null })
  }

  await ingestListens(createServiceClient(), userId, "statsfm", listens)
}
