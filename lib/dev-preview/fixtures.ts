// Dev-preview only. Production code must never import from lib/dev-preview.
import type { CardArtist } from "@/lib/cards/card-artist"
import type { ChallengePayload } from "@/components/feed/challenge-strip"
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

/** Rough shapes seen in real data: popularity 0, hyphenated or long odd genres, a long name. */
const REAL_ROWS: Partial<CardArtist>[] = [
  { popularity: 0, genres: ["alternative-metal", "nu-metal"] },
  { popularity: 0, genres: ["acro jazz laboratories"] },
  { popularity: 2, genres: ["deep progressive house and experimental electronica"] },
  { name: "The Extraordinarily Long-Named Collective of Midnight Players", popularity: 0, genres: [] },
]

/** The fixtures, optionally with real-data shapes swapped into rows 1, 3, 5, 7 and repeated up to `count` artists (fresh ids). */
export function realisticArtists(real: boolean, count = 0): CardArtist[] {
  const base = real ? previewArtists.map((a, i) => (i % 2 === 1 && REAL_ROWS[(i - 1) / 2] ? { ...a, ...REAL_ROWS[(i - 1) / 2] } : a)) : previewArtists
  if (count <= base.length) return base
  return Array.from({ length: count }, (_, i) => {
    const a = base[i % base.length]
    return i < base.length ? a : { ...a, id: `${a.id}-${i}`, topTracks: a.topTracks.map((t) => ({ ...t, id: `${t.id}-${i}` })) }
  })
}

/** The weekly challenge strip on /dev-preview/feed (mockup feed-merge.html §6: 2 of 5 done). */
export const previewChallenge: ChallengePayload = {
  title: "Five in a week",
  description: "like 5 artists this week",
  progress: 2,
  target: 5,
  completed: false,
}
