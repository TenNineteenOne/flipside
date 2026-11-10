/**
 * The feed artist whose track is loaded in the player. Two artists can share a
 * track id (a collaboration), so the artist the feed started playback for wins
 * while that track is still the loaded one; otherwise (the track came from
 * elsewhere, or that artist is gone) the first loaded artist owning the track.
 */
export function nowPlayingArtistId(
  trackId: string | null,
  started: { trackId: string; artistId: string } | null,
  artists: readonly { id: string; tracks: readonly { id: string }[] }[],
): string | null {
  if (trackId === null) return null
  if (started?.trackId === trackId && artists.some((a) => a.id === started.artistId)) return started.artistId
  return artists.find((a) => a.tracks.some((t) => t.id === trackId))?.id ?? null
}

/**
 * Whether `trackId` on `artistId`'s card is the loaded track: the player's track on the artist
 * it is playing for (nowPlayingArtistId), so a collaboration track shows on one card only.
 */
export function isCurrentTrack(
  playingArtistId: string | null,
  playingTrackId: string | null,
  artistId: string,
  trackId: string,
): boolean {
  return playingArtistId === artistId && playingTrackId === trackId
}
