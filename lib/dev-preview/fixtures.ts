// Dev-preview only. Production code must never import from lib/dev-preview.
import type { CardArtist } from "@/lib/cards/card-artist"
import labArtists from "./lab-artists.json" // copied from design-lab:lib/lab/artists.json

/** Fixed fake user seed for the harness identicon (no session). */
export const PREVIEW_USER_SEED = "dev-preview-user"

/**
 * The prototype's 19 artists as production card artists. Edge cases:
 * the 4th has no artist image (tracks keep album art), the 9th has no image and no tracks, and
 * the 2nd's third track is the 1st's first track (a collaboration: two artists sharing a track id).
 */
const mapped: CardArtist[] = labArtists.map((a, i) => ({
  id: a.id,
  name: a.name,
  genres: a.genres,
  imageUrl: i === 3 || i === 8 ? null : a.imageUrl,
  popularity: a.popularity,
  artistColor: a.color,
  why: { sourceArtists: a.why.sourceArtists, genres: a.why.genres },
  topTracks:
    i === 8
      ? []
      : a.tracks.map((t) => ({
          id: t.id,
          spotifyTrackId: null,
          name: t.name,
          previewUrl: t.previewUrl,
          durationMs: t.durationMs,
          albumName: t.albumName,
          albumImageUrl: t.albumImageUrl,
          source: "itunes" as const,
        })),
}))

export const previewArtists: CardArtist[] = mapped.map((a, i) =>
  i === 1 ? { ...a, topTracks: [...a.topTracks.slice(0, 2), mapped[0].topTracks[0]] } : a,
)
