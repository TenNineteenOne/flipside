/**
 * Snap playback hand-over (PRD #182 story 51, issue #192): when an artist
 * becomes current by scrolling, should its first track start?
 * Only while audio is playing and the loaded track is not already this
 * artist's (a track from no feed artist counts as "not this artist").
 */
export function shouldHandOver(artistId: string, isPlaying: boolean, playingArtistId: string | null): boolean {
  return isPlaying && playingArtistId !== artistId
}
