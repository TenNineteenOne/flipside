import { createServiceClient } from "@/lib/supabase/server"
import { musicProvider } from "@/lib/music-provider/provider"

// Normalize artist name for Last.fm matching (lowercase, strip punctuation, trim)
export function normalizeArtistName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^\w\s]/g, "")
    .trim()
}

// Accumulate Spotify top artists + recently played into listened_artists
export async function accumulateSpotifyHistory(params: {
  userId: string      // Supabase user UUID
  accessToken: string // Spotify access token
}): Promise<void> {
  const { userId, accessToken } = params
  const supabase = createServiceClient()

  // Fetch top artists for all three time ranges and recently played in parallel
  const [shortTerm, mediumTerm, longTerm, recentlyPlayed] = await Promise.all([
    musicProvider.getTopArtists(accessToken, "short_term"),
    musicProvider.getTopArtists(accessToken, "medium_term"),
    musicProvider.getTopArtists(accessToken, "long_term"),
    musicProvider.getRecentlyPlayed(accessToken),
  ])

  // Deduplicate top artists by ID (first occurrence wins for name)
  const topArtistIds = new Set<string>()
  for (const artist of [...shortTerm, ...mediumTerm, ...longTerm]) {
    topArtistIds.add(artist.id)
  }

  // Upsert top artists
  for (const spotifyArtistId of topArtistIds) {
    await upsertSpotifyArtist(supabase, userId, spotifyArtistId, "spotify_top")
  }

  // Deduplicate recently played artists by ID
  const recentArtistIds = new Set<string>()
  for (const play of recentlyPlayed) {
    recentArtistIds.add(play.artistId)
  }

  // Upsert recently played artists
  for (const spotifyArtistId of recentArtistIds) {
    await upsertSpotifyArtist(
      supabase,
      userId,
      spotifyArtistId,
      "spotify_recent"
    )
  }
}

async function upsertSpotifyArtist(
  supabase: ReturnType<typeof createServiceClient>,
  userId: string,
  spotifyArtistId: string,
  source: "spotify_top" | "spotify_recent"
): Promise<void> {
  // The unique constraint is (user_id, spotify_artist_id).
  // We use a raw SQL upsert via from().upsert() with ignoreDuplicates: false,
  // but the JS client can't increment on conflict — so we select first, then insert/update.
  const { data: existing, error: selectError } = await supabase
    .from("listened_artists")
    .select("id, play_count")
    .eq("user_id", userId)
    .eq("spotify_artist_id", spotifyArtistId)
    .maybeSingle()

  if (selectError) {
    console.error(
      "[accumulateSpotifyHistory] Select error for artist:",
      spotifyArtistId,
      selectError.message
    )
    return
  }

  if (existing) {
    const { error: updateError } = await supabase
      .from("listened_artists")
      .update({
        play_count: existing.play_count + 1,
        last_seen_at: new Date().toISOString(),
      })
      .eq("id", existing.id)

    if (updateError) {
      console.error(
        "[accumulateSpotifyHistory] Update error for artist:",
        spotifyArtistId,
        updateError.message
      )
    }
  } else {
    const { error: insertError } = await supabase
      .from("listened_artists")
      .insert({
        user_id: userId,
        spotify_artist_id: spotifyArtistId,
        lastfm_artist_name: null,
        source,
        play_count: 1,
        last_seen_at: new Date().toISOString(),
      })

    if (insertError) {
      console.error(
        "[accumulateSpotifyHistory] Insert error for artist:",
        spotifyArtistId,
        insertError.message
      )
    }
  }
}

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

  const baseUrl = "http://ws.audioscrobbler.com/2.0/"

  // Fetch top artists and recent tracks in parallel
  const [topArtistsRes, recentTracksRes] = await Promise.all([
    fetch(
      `${baseUrl}?method=user.getTopArtists&user=${encodeURIComponent(lastfmUsername)}&api_key=${apiKey}&format=json&limit=200`
    ),
    fetch(
      `${baseUrl}?method=user.getRecentTracks&user=${encodeURIComponent(lastfmUsername)}&api_key=${apiKey}&format=json&limit=200`
    ),
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

  const supabase = createServiceClient()

  // Upsert each artist — no unique constraint on (user_id, lastfm_artist_name),
  // so we do select-then-insert/update
  for (const artistName of artistNames) {
    await upsertLastFmArtist(supabase, userId, artistName)
  }
}

async function upsertLastFmArtist(
  supabase: ReturnType<typeof createServiceClient>,
  userId: string,
  artistName: string
): Promise<void> {
  const { data: existing, error: selectError } = await supabase
    .from("listened_artists")
    .select("id, play_count")
    .eq("user_id", userId)
    .eq("lastfm_artist_name", artistName)
    .is("spotify_artist_id", null)
    .maybeSingle()

  if (selectError) {
    console.error(
      "[accumulateLastFmHistory] Select error for artist:",
      artistName,
      selectError.message
    )
    return
  }

  if (existing) {
    const { error: updateError } = await supabase
      .from("listened_artists")
      .update({
        play_count: existing.play_count + 1,
        last_seen_at: new Date().toISOString(),
      })
      .eq("id", existing.id)

    if (updateError) {
      console.error(
        "[accumulateLastFmHistory] Update error for artist:",
        artistName,
        updateError.message
      )
    }
  } else {
    const { error: insertError } = await supabase
      .from("listened_artists")
      .insert({
        user_id: userId,
        spotify_artist_id: null,
        lastfm_artist_name: artistName,
        source: "lastfm",
        play_count: 1,
        last_seen_at: new Date().toISOString(),
      })

    if (insertError) {
      console.error(
        "[accumulateLastFmHistory] Insert error for artist:",
        artistName,
        insertError.message
      )
    }
  }
}
