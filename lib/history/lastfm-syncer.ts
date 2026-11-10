import { createServiceClient } from "@/lib/supabase/server"
import { ingestListens } from "@/lib/history/ingest"
import { lastfm } from "@/lib/lastfm"

// Accumulate Last.fm scrobble history into listened_artists. The adapter
// fetches user.getTopArtists + user.getRecentTracks under the shared Last.fm
// gate (#C8) and throws on a missing key / HTTP / Last.fm error.
export async function accumulateLastFmHistory(params: {
  userId: string
  lastfmUsername: string
}): Promise<void> {
  const { userId, lastfmUsername } = params
  const artistNames = await lastfm.userArtistNames(lastfmUsername)
  await ingestListens(
    createServiceClient(),
    userId,
    "lastfm",
    artistNames.map((name) => ({ name })),
  )
}
