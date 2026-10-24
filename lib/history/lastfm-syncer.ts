import { createServiceClient } from "@/lib/supabase/server"
import { ingestListens } from "@/lib/history/ingest"
import { runLastfm } from "@/lib/lastfm-limit"
import { incLastfmUser } from "@/lib/recommendation/api-call-counter"

interface LastFmTopArtist {
  name: string
  playcount: string
}

interface LastFmRecentTrack {
  artist: { "#text": string }
}

interface LastFmTopArtistsResponse {
  topartists?: { artist: LastFmTopArtist[] }
  error?: number
  message?: string
}

interface LastFmRecentTracksResponse {
  recenttracks?: { track: LastFmRecentTrack | LastFmRecentTrack[] }
  error?: number
  message?: string
}

// Accumulate Last.fm scrobble history into listened_artists
export async function accumulateLastFmHistory(params: {
  userId: string
  lastfmUsername: string
}): Promise<void> {
  const { userId, lastfmUsername } = params
  const apiKey = process.env.LASTFM_API_KEY

  if (!apiKey) {
    throw new Error("Last.fm API key is not configured")
  }

  const baseUrl = "https://ws.audioscrobbler.com/2.0/"

  // Fetch top artists and recent tracks in parallel. Routed through the shared
  // Last.fm limiter (like every other live Last.fm caller) so a burst of
  // history syncs can't bypass the rate/concurrency ceiling (#C8).
  const [topArtistsRes, recentTracksRes] = await Promise.all([
    runLastfm(() => {
      incLastfmUser()
      return fetch(
        `${baseUrl}?method=user.getTopArtists&user=${encodeURIComponent(lastfmUsername)}&api_key=${apiKey}&format=json&limit=200`,
        { signal: AbortSignal.timeout(8000) }
      )
    }),
    runLastfm(() => {
      incLastfmUser()
      return fetch(
        `${baseUrl}?method=user.getRecentTracks&user=${encodeURIComponent(lastfmUsername)}&api_key=${apiKey}&format=json&limit=200`,
        { signal: AbortSignal.timeout(8000) }
      )
    }),
  ])

  if (!topArtistsRes.ok) {
    throw new Error(
      `Failed to fetch Last.fm top artists (HTTP ${topArtistsRes.status})`
    )
  }
  if (!recentTracksRes.ok) {
    throw new Error(
      `Failed to fetch Last.fm recent tracks (HTTP ${recentTracksRes.status})`
    )
  }

  const topArtistsData = (await topArtistsRes.json()) as LastFmTopArtistsResponse
  const recentTracksData =
    (await recentTracksRes.json()) as LastFmRecentTracksResponse

  if (topArtistsData.error) {
    throw new Error(
      topArtistsData.message ??
        `Last.fm error ${topArtistsData.error}: could not load top artists for "${lastfmUsername}"`
    )
  }
  if (recentTracksData.error) {
    throw new Error(
      recentTracksData.message ??
        `Last.fm error ${recentTracksData.error}: could not load recent tracks for "${lastfmUsername}"`
    )
  }

  // Collect all unique artist names
  const artistNames = new Set<string>()

  const topArtists = topArtistsData.topartists?.artist ?? []
  for (const artist of topArtists) {
    if (artist.name) {
      artistNames.add(artist.name)
    }
  }

  const rawTracks = recentTracksData.recenttracks?.track ?? []
  const recentTracks = Array.isArray(rawTracks) ? rawTracks : [rawTracks]
  for (const track of recentTracks) {
    const name = track.artist?.["#text"]
    if (name) {
      artistNames.add(name)
    }
  }

  await ingestListens(
    createServiceClient(),
    userId,
    "lastfm",
    [...artistNames].map((name) => ({ name })),
  )
}
