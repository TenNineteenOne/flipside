/**
 * Artwork for an artist card (PRD #182, Modules 3): the artist image, else the
 * first track's album image, else null (the UI then shows a colour panel with
 * the artist's first letter, never a broken image). Empty strings count as missing.
 */
export function artworkFor(artist: {
  imageUrl: string | null
  topTracks: readonly { albumImageUrl: string | null }[]
}): string | null {
  return artist.imageUrl || artist.topTracks[0]?.albumImageUrl || null
}
